import { parseCardSearchQuery } from "./pokemonCardSearchCore.ts";
import type { UnifiedCardSearchInput } from "./unifiedCardSearchCore.ts";

export interface CardSearchRequest {
  game: "pokemon" | "one_piece";
  language: "en" | "ja";
  query: string;
  name?: string | null;
  collectorNumber?: string | null;
  set?: string | null;
  abilityName?: string | null;
  attackName?: string | null;
  page?: number;
  pageSize?: number;
}

export type CardSearchRequestWithOptions = CardSearchRequest & {
  finish?: string | null;
  cardType?: string | null;
  disableCorrection?: boolean;
  providerCardId?: string;
  id?: string;
};
export type BuiltCardSearchRequest = CardSearchRequestWithOptions & {
  page: number;
  pageSize: number;
};

type JsonRecord = Record<string, unknown>;

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function buildCardSearchRequest(
  input: UnifiedCardSearchInput & { page?: number; pageSize?: number },
): BuiltCardSearchRequest {
  const requestedGame = String(input.game || "pokemon").trim();
  if (requestedGame !== "pokemon" && requestedGame !== "one_piece") {
    throw new Error(`Invalid card-search game: ${requestedGame || "(empty)"}.`);
  }
  const requestedLanguage = String(input.language || "en").trim();
  if (requestedLanguage !== "en" && requestedLanguage !== "ja") {
    throw new Error(`Invalid card-search language: ${requestedLanguage || "(empty)"}.`);
  }

  const originalQuery = String(input.query ?? "").trim();
  const fallbackQuery = [optionalText(input.name), optionalText(input.collectorNumber), optionalText(input.abilityName), optionalText(input.attackName)].filter(Boolean).join(" ");
  const query = originalQuery || fallbackQuery;
  const parsed = parseCardSearchQuery({ ...input, query });
  const abilityName = optionalText(input.abilityName);
  const attackName = optionalText(input.attackName);
  const explicitName = optionalText(input.name);
  const explicitCollectorNumber = optionalText(input.collectorNumber);
  const fingerprintOnly = Boolean(!explicitName && !explicitCollectorNumber && (abilityName || attackName));
  const name = explicitName || (fingerprintOnly ? null : optionalText(parsed.originalName));
  const collectorNumber = explicitCollectorNumber || (fingerprintOnly ? null : optionalText(parsed.collector?.normalized));
  const providerCardId = optionalText(input.providerCardId);
  if (!query && !collectorNumber && !providerCardId && !abilityName && !attackName) {
    throw new Error("Enter a card name, query, or collector number.");
  }

  return {
    game: requestedGame,
    language: requestedLanguage,
    query,
    name,
    collectorNumber,
    set: optionalText(input.set),
    ...(abilityName ? { abilityName } : {}),
    ...(attackName ? { attackName } : {}),
    page: Math.max(1, Math.floor(Number(input.page) || 1)),
    pageSize: Math.min(30, Math.max(1, Math.floor(Number(input.pageSize) || 30))),
    ...(optionalText(input.finish) ? { finish: optionalText(input.finish)! } : {}),
    ...(optionalText(input.cardType) ? { cardType: optionalText(input.cardType)! } : {}),
    ...(input.disableCorrection ? { disableCorrection: true } : {}),
    ...(providerCardId ? { providerCardId } : {}),
  };
}

export function parseCompatibleCardSearchRequest(body: JsonRecord): BuiltCardSearchRequest {
  const rawQuery = [
    body.query,
    body.search,
    body.searchQuery,
    body.rawQuery,
    body.q,
    body.cardName,
    body.name,
  ].find((value) => String(value ?? "").trim()) ?? "";
  const collectorNumber = [
    body.collectorNumber,
    body.collector_number,
    body.cardNumber,
  ].find((value) => String(value ?? "").trim()) ?? null;
  const name = body.name ?? body.cardName ?? null;
  return {
    game: String(body.game || "") as CardSearchRequest["game"],
    language: String(body.language || "") as CardSearchRequest["language"],
    query: String(rawQuery).trim(),
    name: name == null ? null : String(name).trim() || null,
    collectorNumber: collectorNumber == null ? null : String(collectorNumber).trim() || null,
    set: body.set == null ? null : String(body.set).trim() || null,
    ...(body.abilityName == null || !String(body.abilityName).trim() ? {} : { abilityName: String(body.abilityName).trim() }),
    ...(body.attackName == null || !String(body.attackName).trim() ? {} : { attackName: String(body.attackName).trim() }),
    page: Number(body.page) || 1,
    pageSize: Number(body.pageSize) || 30,
    finish: body.finish == null ? null : String(body.finish).trim() || null,
    cardType: body.cardType == null ? null : String(body.cardType).trim() || null,
    disableCorrection: body.disableCorrection === true,
    providerCardId: String(body.providerCardId || "").trim() || undefined,
    id: String(body.id || "").trim() || undefined,
  };
}
