import { format } from "date-fns";
import { extractDate, extractTimeText } from "./dateExtractor";
import { extractLinks } from "./linkExtractor";

export type EventDetectionClassification =
  | "event_high_confidence"
  | "event_needs_review"
  | "possible_but_low_confidence"
  | "not_event";

export interface EventDetectionResult {
  score: number;
  classification: EventDetectionClassification;
  reasons: string[];
  warnings: string[];
  matchedKeywords: string[];
  missingFields: string[];
}

const eventKeywords = [
  "event",
  "show",
  "card show",
  "collectibles show",
  "expo",
  "convention",
  "meetup",
  "tournament",
  "trade night",
  "pop-up",
  "vendor event"
];

const tcgKeywords = [
  "pokemon",
  "pokémon",
  "tcg",
  "trading cards",
  "sports cards",
  "one piece",
  "lorcana",
  "yu-gi-oh",
  "collectibles",
  "anime"
];

const vendorKeywords = [
  "vendor",
  "vendors",
  "vendor registration",
  "booth",
  "table",
  "tables",
  "vendor application",
  "apply now",
  "vendors wanted"
];

const productKeywords = ["restock", "in stock", "new arrivals", "sale", "discount", "box break", "live sale", "claim sale", "auction"];
const giveawayKeywords = ["giveaway", "winner", "raffle"];
const memeKeywords = ["meme", "funny", "joke"];
const registrationLinkHints = ["register", "vendor", "vendors", "table", "booth", "form", "apply", "eventbrite", "jotform", "google"];
const cityStatePattern = /\b([A-Z][a-zA-Z .'-]+),?\s+([A-Z]{2})\b/;
const addressPattern = /\b\d{1,6}\s+[A-Za-z0-9 .'-]+\s+(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct)\b/i;

function findKeywords(text: string, keywords: string[]) {
  const lowered = text.toLowerCase();
  return keywords.filter((keyword) => lowered.includes(keyword.toLowerCase()));
}

function classify(score: number): EventDetectionClassification {
  if (score >= 70) return "event_high_confidence";
  if (score >= 45) return "event_needs_review";
  if (score >= 25) return "possible_but_low_confidence";
  return "not_event";
}

export function detectEvent(rawText: string, options: { sourceTitle?: string; sourceDate?: Date } = {}): EventDetectionResult {
  let score = 0;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const matchedKeywords: string[] = [];
  const missingFields: string[] = [];
  const text = rawText || "";
  const sourceTitle = options.sourceTitle || "";
  const { startDate } = extractDate(text, options.sourceDate);
  const start = startDate ? new Date(startDate) : undefined;
  const futureDate = Boolean(start && start.getTime() > Date.now());
  const timeText = extractTimeText(text);
  const registrationLink = extractLinks(text).find((link) => registrationLinkHints.some((hint) => link.toLowerCase().includes(hint)));
  const eventMatches = findKeywords(text, eventKeywords);
  const tcgMatches = findKeywords(text, tcgKeywords);
  const vendorMatches = findKeywords(text, vendorKeywords);
  const productMatches = findKeywords(text, productKeywords);
  const giveawayMatches = findKeywords(text, giveawayKeywords);
  const memeMatches = findKeywords(text, memeKeywords);
  const hasLocation = cityStatePattern.test(text) || addressPattern.test(text);
  const titleMatches = findKeywords(sourceTitle, eventKeywords);

  if (futureDate && start) {
    score += 30;
    reasons.push(`Found future date: ${format(start, "MMM d")}`);
  }
  if (timeText) {
    score += 10;
    reasons.push(`Found time: ${timeText}`);
  }
  if (eventMatches.length) {
    score += 25;
    matchedKeywords.push(...eventMatches);
    reasons.push(`Found event keyword: ${eventMatches[0]}`);
  }
  if (tcgMatches.length) {
    score += 15;
    matchedKeywords.push(...tcgMatches);
    reasons.push(`Found Pokemon/TCG keyword: ${tcgMatches[0]}`);
  }
  if (vendorMatches.length) {
    score += 25;
    matchedKeywords.push(...vendorMatches);
    reasons.push(`Found vendor keyword: ${vendorMatches[0]}`);
  }
  if (hasLocation) {
    score += 20;
    reasons.push("Found location/address/city/state");
  }
  if (registrationLink) {
    score += 25;
    reasons.push("Found registration link");
  }
  if (titleMatches.length) {
    score += 10;
    matchedKeywords.push(...titleMatches);
    reasons.push(`Source title contains event-like word: ${titleMatches[0]}`);
  }

  if (productMatches.length) {
    score -= 25;
    matchedKeywords.push(...productMatches);
    warnings.push("Looks like product/restock post, not an event");
  }
  if (giveawayMatches.length) {
    score -= 20;
    matchedKeywords.push(...giveawayMatches);
    warnings.push("Looks like giveaway-only post");
  }
  if (memeMatches.length) {
    score -= 20;
    matchedKeywords.push(...memeMatches);
    warnings.push("Looks like meme/content-only post");
  }
  if (!startDate) {
    score -= 20;
    missingFields.push("date");
    warnings.push("No date found");
  }
  if (!eventMatches.length && !vendorMatches.length && !hasLocation) {
    score -= 30;
    warnings.push("No event/vendor/location keywords found");
  }
  if (!timeText) missingFields.push("time");
  if (!hasLocation) {
    missingFields.push("location");
    warnings.push("Missing full address");
  }
  if (!registrationLink) missingFields.push("registration link");

  const normalizedScore = Math.max(0, score);
  return {
    score: normalizedScore,
    classification: classify(normalizedScore),
    reasons,
    warnings,
    matchedKeywords: Array.from(new Set(matchedKeywords)),
    missingFields: Array.from(new Set(missingFields))
  };
}
