import type { ParsedEventCandidate, SourceType } from "../../types/models";
import { id, nowIso, textSnippet } from "../../utils/normalize";
import { extractDate, extractTimeText } from "./dateExtractor";
import { detectEvent } from "./eventDetector";
import { pickRegistrationLink } from "./linkExtractor";
import { parseRegistrationStatus } from "./registrationStatusParser";

const eventKeywords = /\b(pokemon|pokémon|tcg|card show|trading cards|collectibles|anime|toy show|convention|expo|vendors?|vendor registration|vendor tables?)\b/i;
const cityStatePattern = /\b([A-Z][a-zA-Z .'-]+),?\s+([A-Z]{2})\b/;
const venuePattern = /\bat\s+([^.\n,]+(?:show|expo|center|mall|market|convention|arena|hall|shop|store)?)/i;

function guessEventName(text: string) {
  const firstLine = text.split(/\n|[.!?]/).map((line) => line.trim()).find((line) => line.length > 8);
  if (!firstLine) return "Possible Event";
  return firstLine.replace(/^vendor registration is now open!?\s*/i, "").slice(0, 80);
}

function guessLocation(text: string, defaults?: { venueName?: string; address?: string; city?: string; state?: string }) {
  const cityState = text.match(cityStatePattern);
  const venue = text.match(venuePattern);
  return {
    venueName: venue?.[1]?.trim() || defaults?.venueName,
    address: defaults?.address,
    city: cityState?.[1]?.trim() || defaults?.city,
    state: cityState?.[2]?.trim() || defaults?.state
  };
}

export function parseEventText(options: {
  rawText: string;
  sourceType: SourceType;
  sourceUrl?: string;
  sourceId?: string;
  organizerId?: string;
  sourceDate?: Date;
  sourceTitle?: string;
  sourceName?: string;
  defaultVenueName?: string;
  defaultAddress?: string;
  defaultCity?: string;
  defaultState?: string;
}): ParsedEventCandidate {
  const timestamp = nowIso();
  const { startDate, endDate } = extractDate(options.rawText, options.sourceDate);
  const timeText = extractTimeText(options.rawText);
  const registrationUrl = pickRegistrationLink(options.rawText);
  const registrationStatus = parseRegistrationStatus(options.rawText);
  const location = guessLocation(options.rawText, {
    venueName: options.defaultVenueName,
    address: options.defaultAddress,
    city: options.defaultCity,
    state: options.defaultState
  });
  const detection = detectEvent(options.rawText, { sourceDate: options.sourceDate, sourceTitle: options.sourceTitle });
  const warnings: string[] = [...detection.warnings];

  if (!eventKeywords.test(options.rawText)) warnings.push("No clear TCG/vendor event keyword found.");
  if (!startDate) warnings.push("No event date found.");
  if (!location.city && !location.venueName) warnings.push("No clear location found.");
  if (startDate && (options.defaultVenueName || options.defaultAddress || options.defaultCity) && !cityStatePattern.test(options.rawText)) {
    warnings.push("Used saved source default location.");
  }
  if (/link in bio/i.test(options.rawText) && !registrationUrl) warnings.push("Caption says link in bio; paste the direct vendor link if you have it.");

  const confidence =
    detection.classification === "event_high_confidence"
      ? "high"
      : detection.classification === "event_needs_review"
          || (startDate && (options.defaultVenueName || options.defaultAddress || options.defaultCity))
        ? "medium"
        : "low";

  return {
    id: id("candidate"),
    sourceId: options.sourceId,
    organizerId: options.organizerId,
    sourceUrl: options.sourceUrl,
    rawText: options.rawText,
    rawTextSnippet: textSnippet(options.rawText),
    eventName: options.sourceName && guessEventName(options.rawText) === "Possible Event" ? `${options.sourceName} Update` : guessEventName(options.rawText),
    startDate,
    endDate,
    timeText,
    ...location,
    registrationUrl,
    registrationStatus,
    confidence,
    detectionScore: detection.score,
    classification: detection.classification,
    reasons: detection.reasons,
    warnings: Array.from(new Set(warnings)),
    matchedKeywords: detection.matchedKeywords,
    missingFields: detection.missingFields,
    reviewStatus: "pending",
    createdAt: timestamp
  };
}

export const parserFixtures = [
  "Vendor registration is now open! Join us May 31st from 10AM-5PM at Newark Card Show, Newark NJ. Tables are limited. Register here: https://example.com/vendor-form",
  "TCG/Card Show this Saturday! Pokémon, One Piece, sports cards, collectibles. Vendors wanted. DM us or link in bio.",
  "June 8, 2026 - Collectibles Expo. Vendor tables sold out. Waitlist available."
];
