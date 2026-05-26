import type { ParsedEventCandidate } from "../../types/models";
import { id } from "../../utils/normalize";
import { getSettings, db } from "../storage/localDb";

export async function shouldKeepDetectedCandidate(candidate: ParsedEventCandidate) {
  if (candidate.classification === "not_event") return false;
  if (candidate.classification === "possible_but_low_confidence") {
    const settings = await getSettings();
    return settings.showLowConfidenceResults;
  }
  return true;
}

export async function storeScrapeLog(candidate: ParsedEventCandidate) {
  await db.scrapeLogs.add({
    id: id("log"),
    sourceId: candidate.sourceId,
    sourceUrl: candidate.sourceUrl,
    rawTextSnippet: candidate.rawTextSnippet,
    score: candidate.detectionScore,
    classification: candidate.classification,
    reasons: candidate.reasons,
    warnings: candidate.warnings,
    matchedKeywords: candidate.matchedKeywords,
    missingFields: candidate.missingFields,
    createdAt: new Date().toISOString()
  });
}
