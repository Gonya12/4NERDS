import { CapacitorHttp } from "@capacitor/core";
import { extractEventBlocksFromText } from "../parser/eventBlockExtractor";
import { parseEventText } from "../parser/eventTextParser";
import { shouldKeepDetectedCandidate, storeScrapeLog } from "./detectionPolicy";
import type { SourceAdapter } from "./types";

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|article|section|li|h1|h2|h3|h4|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n");
}

async function fetchPublicPage(url: string) {
  try {
    const response = await CapacitorHttp.get({
      url,
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml,text/plain,*/*"
      }
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`Page returned ${response.status}`);
    return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Page returned ${response.status}`);
    return response.text();
  }
}

export const staticWebsiteScraper: SourceAdapter = {
  type: "website",
  async run(source) {
    if (!source.url) return { source, candidates: [], status: "Missing URL", error: "No URL set." };
    const html = await fetchPublicPage(source.url);
    const title = html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
    const text = htmlToText(html);
    const blocks = extractEventBlocksFromText(text, title);
    const candidates = [];

    for (const block of blocks) {
      const candidate = parseEventText({
        rawText: block,
        sourceType: source.type,
        sourceUrl: source.url,
        sourceId: source.id,
        organizerId: source.organizerId,
        sourceTitle: title || source.name,
        sourceName: source.name,
        defaultVenueName: source.defaultVenueName,
        defaultAddress: source.defaultAddress,
        defaultCity: source.defaultCity,
        defaultState: source.defaultState
      });
      if (await shouldKeepDetectedCandidate(candidate)) candidates.push(candidate);
      else await storeScrapeLog(candidate);
    }

    return { source, candidates, status: `Checked website (${candidates.length} possible from ${blocks.length} blocks)` };
  }
};
