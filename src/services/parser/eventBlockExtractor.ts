import { detectEvent } from "./eventDetector";

const eventishPattern = /\b(event|show|card show|collectibles show|expo|convention|meetup|tournament|trade night|pop-up|vendor|vendors|pokemon|pokémon|tcg|anime)\b/i;
const monthPattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b/i;
const numericDatePattern = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueBlocks(blocks: string[]) {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const key = block.toLowerCase().slice(0, 220);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractEventBlocksFromText(text: string, sourceTitle?: string) {
  const normalized = text.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n");
  const paragraphs = normalized
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z0-9])/)
    .map(normalizeWhitespace)
    .filter((paragraph) => paragraph.length >= 35 && paragraph.length <= 2500);

  const directMatches = paragraphs.filter((paragraph) =>
    eventishPattern.test(paragraph) || monthPattern.test(paragraph) || numericDatePattern.test(paragraph)
  );

  const windowedMatches: string[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const joined = normalizeWhitespace(paragraphs.slice(index, index + 3).join(" "));
    if (joined.length >= 60 && joined.length <= 3000 && (eventishPattern.test(joined) || monthPattern.test(joined) || numericDatePattern.test(joined))) {
      windowedMatches.push(joined);
    }
  }

  const scored = uniqueBlocks([...directMatches, ...windowedMatches])
    .map((block) => ({ block, detection: detectEvent(block, { sourceTitle }) }))
    .filter(({ detection }) => detection.score >= 25)
    .sort((a, b) => b.detection.score - a.detection.score);

  if (scored.length > 0) return scored.slice(0, 15).map(({ block }) => block);
  return [normalizeWhitespace(text).slice(0, 4000)].filter(Boolean);
}
