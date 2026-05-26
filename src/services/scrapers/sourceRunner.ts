import type { Source } from "../../types/models";
import { nowIso } from "../../utils/normalize";
import { getSettings } from "../storage/localDb";
import { notifyNewCandidate, notifyRegistrationOpen } from "../notifications/notificationService";
import { listSources, saveCandidates, saveSource } from "../sync/sharedRepository";
import { redditPublicScraper } from "./redditPublicScraper";
import { rssFeedScraper } from "./rssFeedScraper";
import { staticWebsiteScraper } from "./staticWebsiteScraper";
import type { SourceAdapter } from "./types";

const adapters: SourceAdapter[] = [staticWebsiteScraper, rssFeedScraper, redditPublicScraper];

function adapterFor(source: Source) {
  if (source.type === "event_page" || source.type === "facebook_page") return staticWebsiteScraper;
  return adapters.find((adapter) => adapter.type === source.type);
}

function canRefreshSource(source: Source, force: boolean, intervalHours: number) {
  if (force || !source.lastCheckedAt) return true;
  return Date.now() - new Date(source.lastCheckedAt).getTime() >= intervalHours * 60 * 60 * 1000;
}

export async function refreshSource(source: Source, options: { force?: boolean } = {}) {
  const settings = await getSettings();
  if (!canRefreshSource(source, Boolean(options.force), settings.sourceRefreshIntervalHours)) return [];

  const isInstagram = source.type === "instagram_page" || source.type === "instagram_manual" || source.url?.includes("instagram.com");
  if (isInstagram) {
    await saveSource({
      ...source,
      lastCheckedAt: nowIso(),
      lastStatus: "Instagram needs caption/text paste",
      lastError: "Instagram needs caption/text paste",
      foundCount: 0,
      updatedAt: nowIso()
    });
    return [];
  }

  const adapter = adapterFor(source);
  if (!adapter) {
    await saveSource({
      ...source,
      lastCheckedAt: nowIso(),
      lastStatus: "Manual refresh only",
      lastError: "",
      foundCount: 0,
      updatedAt: nowIso()
    });
    return [];
  }

  try {
    const result = await adapter.run(source);
    await saveCandidates(result.candidates);
    const updatedSource = {
      ...source,
      lastCheckedAt: nowIso(),
      lastStatus: result.status,
      lastError: result.error || "",
      foundCount: result.candidates.length,
      updatedAt: nowIso()
    };
    await saveSource(updatedSource);
    for (const candidate of result.candidates) {
      await notifyNewCandidate(candidate);
      if (candidate.registrationStatus === "open") {
        await notifyRegistrationOpen(candidate.eventName || source.name, candidate.id);
      }
    }
    return result.candidates;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown refresh error";
    await saveSource({
      ...source,
      lastCheckedAt: nowIso(),
      lastStatus: "Could not read page",
      lastError: message,
      foundCount: 0,
      updatedAt: nowIso()
    });
    return [];
  }
}

export async function refreshAllSources(options: { force?: boolean } = {}) {
  const sources = (await listSources()).filter((source) => source.enabled);
  const results = [];
  for (const source of sources) {
    results.push(...await refreshSource(source, options));
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return results;
}
