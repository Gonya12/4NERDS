import { parseEventText } from "../parser/eventTextParser";
import type { Source } from "../../types/models";

export function parseManualInstagramImport(postUrl: string, caption: string) {
  return parseEventText({
    rawText: caption,
    sourceType: "instagram_manual",
    sourceUrl: postUrl
  });
}

export function parseManualSourceUpdate(source: Source, text: string) {
  return parseEventText({
    rawText: text,
    sourceType: source.type,
    sourceUrl: source.url,
    sourceId: source.id,
    organizerId: source.organizerId,
    sourceTitle: source.name,
    sourceName: source.name,
    defaultVenueName: source.defaultVenueName,
    defaultAddress: source.defaultAddress,
    defaultCity: source.defaultCity,
    defaultState: source.defaultState
  });
}

const instagramUrlPattern = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?[^\s]*/gi;

function cleanChunk(value: string) {
  return value
    .replace(/^\s*(caption|post|url)\s*:\s*/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitInstagramBatch(rawInput: string) {
  const input = rawInput.trim();
  if (!input) return [];

  const matches = Array.from(input.matchAll(instagramUrlPattern));
  if (matches.length === 0) {
    return input
      .split(/\n\s*---+\s*\n|\n\s*#{3,}\s*\n/g)
      .map((caption) => ({ postUrl: "", caption: cleanChunk(caption) }))
      .filter((item) => item.caption.length > 0);
  }

  return matches.map((match, index) => {
    const postUrl = match[0].replace(/[),.]+$/, "");
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index || input.length : input.length;
    const caption = cleanChunk(input.slice(start, end));
    return { postUrl, caption: caption || postUrl };
  });
}

export function parseInstagramBatch(rawInput: string) {
  return splitInstagramBatch(rawInput).map((item) => parseManualInstagramImport(item.postUrl, item.caption));
}
