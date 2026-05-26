import { parseEventText } from "../parser/eventTextParser";
import { shouldKeepDetectedCandidate, storeScrapeLog } from "./detectionPolicy";
import type { SourceAdapter } from "./types";

export const rssFeedScraper: SourceAdapter = {
  type: "rss",
  async run(source) {
    if (!source.url) return { source, candidates: [], status: "Missing URL", error: "No URL set." };
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`RSS returned ${response.status}`);
    const xml = await response.text();
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const items = Array.from(doc.querySelectorAll("item, entry")).slice(0, 10);
    const parsed = items
      .map((item) => {
        const title = item.querySelector("title")?.textContent || "";
        const summary = item.querySelector("description, summary, content")?.textContent || "";
        const link = item.querySelector("link")?.getAttribute("href") || item.querySelector("link")?.textContent || source.url;
        return parseEventText({
          rawText: `${title}\n${summary}`,
          sourceType: "rss",
          sourceUrl: link,
          sourceId: source.id,
          organizerId: source.organizerId,
          sourceTitle: title || source.name,
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
    return { source, candidates, status: `Checked RSS (${candidates.length} possible)` };
  }
};
