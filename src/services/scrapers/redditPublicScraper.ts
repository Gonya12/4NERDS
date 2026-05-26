import { parseEventText } from "../parser/eventTextParser";
import { shouldKeepDetectedCandidate, storeScrapeLog } from "./detectionPolicy";
import type { SourceAdapter } from "./types";

function toJsonUrl(url: string) {
  const clean = url.replace(/\/$/, "");
  return clean.endsWith(".json") ? clean : `${clean}.json`;
}

export const redditPublicScraper: SourceAdapter = {
  type: "reddit",
  async run(source) {
    if (!source.url) return { source, candidates: [], status: "Missing URL", error: "No URL set." };
    const response = await fetch(toJsonUrl(source.url));
    if (!response.ok) throw new Error(`Reddit returned ${response.status}`);
    const json = await response.json();
    const posts = json?.data?.children || [];
    const parsed = posts.slice(0, 10)
      .map((post: any) => {
        const data = post.data || {};
        return parseEventText({
          rawText: `${data.title || ""}\n${data.selftext || ""}`,
          sourceType: "reddit",
          sourceUrl: data.url || source.url,
          sourceId: source.id,
          organizerId: source.organizerId,
          sourceTitle: data.title || source.name,
          sourceName: source.name,
          defaultVenueName: source.defaultVenueName,
          defaultAddress: source.defaultAddress,
          defaultCity: source.defaultCity,
          defaultState: source.defaultState
        });
      });
    const candidates = [];
    for (const candidate of parsed) {
      if (await shouldKeepDetectedCandidate(candidate)) candidates.push(candidate);
      else await storeScrapeLog(candidate);
    }
    return { source, candidates, status: `Checked Reddit (${candidates.length} possible)` };
  }
};
