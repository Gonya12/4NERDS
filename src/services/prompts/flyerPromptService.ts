import { format, parseISO } from "date-fns";
import type { Event, EventDay, Worker } from "../../types/models";
import { availabilitySummaryByWorker } from "../../utils/availability";
import { dateRangeSummary, eventDays, formatEventDay } from "../../utils/eventSchedule";

export type FlyerPromptMode = "short" | "detailed";
export type FlyerPromptKind = "instagram_flyer" | "instagram_story" | "square_post" | "simple_announcement" | "bold_poster";

export type FlyerBrandDefaults = {
  businessName: string;
  instagramHandle: string;
  tagline: string;
  cta: string;
  defaultFlyerStyle: string;
  preferredColors: string;
  preferredLayout: string;
  brandingNotes: string;
};

export type FlyerPromptOptions = {
  includeCta: boolean;
  includeOrganizerHandle: boolean;
  includeDateTime: boolean;
  includeAddress: boolean;
  includeBuyTrade: boolean;
};

export type InstagramCaptionOptions = {
  includeHostHandle: boolean;
  includeHashtags: boolean;
  mode: "short" | "detailed";
};

const defaultsKey = "4nerds_flyer_prompt_defaults_v1";

export const defaultFlyerBrandDefaults: FlyerBrandDefaults = {
  businessName: "4 Nerds",
  instagramHandle: "",
  tagline: "Pokémon cards, Pokémon singles, and Pokémon sealed products",
  cta: "Come visit us for great Pokémon card deals, buying, selling, and trading Pokémon cards.",
  defaultFlyerStyle: "bold modern Pokémon card vendor style with a Pokémon TCG event look",
  preferredColors: "dark background with bright red, yellow, blue, and electric accent colors",
  preferredLayout: "Instagram portrait flyer in 4:5 aspect ratio",
  brandingNotes: "Keep text readable, clean, high contrast, and social-media friendly."
};

export const defaultFlyerPromptOptions: FlyerPromptOptions = {
  includeCta: true,
  includeOrganizerHandle: true,
  includeDateTime: true,
  includeAddress: false,
  includeBuyTrade: true
};

const promptKindLabels: Record<FlyerPromptKind, string> = {
  instagram_flyer: "Instagram promotional flyer",
  instagram_story: "Instagram Story vertical promotional graphic",
  square_post: "Instagram portrait post",
  simple_announcement: "simple clean announcement graphic",
  bold_poster: "bold promotional poster"
};

export function loadFlyerBrandDefaults(): FlyerBrandDefaults {
  try {
    return pokemonOnlyDefaults({ ...defaultFlyerBrandDefaults, ...JSON.parse(localStorage.getItem(defaultsKey) || "{}") });
  } catch {
    return defaultFlyerBrandDefaults;
  }
}

export function saveFlyerBrandDefaults(defaults: FlyerBrandDefaults) {
  localStorage.setItem(defaultsKey, JSON.stringify(pokemonOnlyDefaults(defaults)));
}

export function generateFlyerPrompt(event: Event, workers: Worker[], defaults: FlyerBrandDefaults, kind: FlyerPromptKind, mode: FlyerPromptMode, options: FlyerPromptOptions) {
  return mode === "short"
    ? shortFlyerPrompt(event, workers, defaults, kind, options)
    : detailedFlyerPrompt(event, workers, defaults, kind, options);
}

export function generateCaptionPrompt(event: Event, workers: Worker[], defaults: FlyerBrandDefaults, options: FlyerPromptOptions) {
  return generateInstagramCaptionText(event, workers, defaults, {
    includeHostHandle: options.includeOrganizerHandle,
    includeHashtags: true,
    mode: "detailed"
  });
}

export function generateInstagramCaptionText(event: Event, workers: Worker[], defaults: FlyerBrandDefaults, options: InstagramCaptionOptions) {
  const businessName = defaults.businessName || "4 Nerds";
  const location = locationSummary(event, false);
  const hostHandle = options.includeHostHandle ? eventHostHandle(event) : "";
  const attendance = attendanceText(event, workers);
  const time = timeSummary(event);
  const intro = `${businessName} will be attending ${event.name} ${datePhrase(event)} at ${location}! 🎉`;
  const detailLine = options.mode === "short"
    ? "Come visit us for Pokémon cards, great deals, buying, selling, and trading."
    : `${attendance}, so come visit us for Pokémon cards, great deals, buying, selling, and trading.`;
  const timeLine = options.mode === "detailed" && time && !time.includes("optional") ? `Event time: ${time}` : "";
  const hostLine = hostHandle ? `Hosted by ${hostHandle}` : "";
  const brandHandle = normalizeHandle(defaults.instagramHandle);
  const buyTradeLine = "We buy and trade — bring your Pokémon cards! 🔥";
  const hashtags = options.includeHashtags
    ? "#4Nerds #PokemonCards #PokemonTCG #PokemonCardShow #CardShow #TradingCards #PokemonCollectors #TCGCommunity"
    : "";

  return [
    intro,
    detailLine,
    timeLine,
    hostLine,
    brandHandle,
    buyTradeLine,
    hashtags
  ].filter(Boolean).join("\n\n");
}

function shortFlyerPrompt(event: Event, workers: Worker[], defaults: FlyerBrandDefaults, kind: FlyerPromptKind, options: FlyerPromptOptions) {
  const where = locationSummary(event, false);
  return [
    `Create this as an Instagram portrait flyer in 4:5 aspect ratio.`,
    `${defaults.businessName || "4 Nerds"} is a Pokémon card vendor brand.`,
    `Create a ${promptKindLabels[kind]} for ${defaults.businessName || "4 Nerds"} announcing we will be attending ${event.name} ${datePhrase(event)} at ${where}.`,
    options.includeDateTime ? `Include time details: ${timeSummary(event)}.` : "",
    `Use a ${defaults.defaultFlyerStyle || "bold Pokémon card vendor vibe, Pokémon TCG event style, trading card show atmosphere"}.`,
    "Feature Pokémon cards, Pokémon singles, and Pokémon sealed products only.",
    `Include text like "We Will Be Attending," "Come Visit Us"${options.includeBuyTrade ? ', and "We Buy and Trade."' : "."}`,
    options.includeCta ? defaults.cta : "",
    organizerLine(event, options),
    "Make it eye-catching, readable, modern, and social-media friendly."
  ].filter(Boolean).join(" ");
}

function detailedFlyerPrompt(event: Event, workers: Worker[], defaults: FlyerBrandDefaults, kind: FlyerPromptKind, options: FlyerPromptOptions) {
  const fullAddress = locationSummary(event, options.includeAddress);
  return [
    `Create this as an Instagram portrait flyer in 4:5 aspect ratio.`,
    `${defaults.businessName || "4 Nerds"} is a Pokémon card vendor brand.`,
    `Create a bold, eye-catching ${promptKindLabels[kind]} for ${defaults.businessName || "4 Nerds"}.`,
    `The design should announce that ${defaults.businessName || "4 Nerds"} will be attending ${event.name} ${datePhrase(event)} at ${fullAddress}.`,
    `${attendanceText(event, workers)}.`,
    options.includeDateTime ? `Show the event schedule clearly: ${eventDays(event).map((day) => formatEventDay(day)).join("; ")}.` : "",
    `Make the design modern, energetic, and social-media-friendly with a Pokémon card vendor vibe, Pokémon TCG event style, and trading card show atmosphere.`,
    `Only reference Pokémon cards, Pokémon TCG, Pokémon singles, Pokémon sealed products, and buying, selling, and trading Pokémon cards.`,
    `Use strong title hierarchy, readable text, polished spacing, and a clean layout suitable for Instagram.`,
    defaults.preferredLayout ? `Preferred layout: ${defaults.preferredLayout}. Keep the final image 4:5.` : "Preferred layout: Instagram portrait flyer in 4:5 aspect ratio.",
    defaults.preferredColors ? `Preferred colors: ${defaults.preferredColors}.` : "",
    defaults.tagline ? `Brand/tagline idea: ${defaults.tagline}.` : "",
    `Include phrases such as "We Will Be Attending" and "Come Visit Us"${options.includeBuyTrade ? ', plus "We Buy and Trade."' : "."}`,
    options.includeCta ? `Call to action: ${defaults.cta}` : "",
    organizerLine(event, options),
    event.imageUrl ? "The event already has a flyer/image saved, so the new design can be inspired by the event style and colors, but should not copy it exactly." : "",
    defaults.instagramHandle ? `Include ${defaults.instagramHandle} in small readable text if useful.` : "",
    defaults.brandingNotes ? `Branding notes: ${defaults.brandingNotes}` : "",
    "Do not make the text cluttered. Prioritize readability and a professional promotional flyer feel."
  ].filter(Boolean).join(" ");
}

function pokemonOnlyDefaults(defaults: FlyerBrandDefaults): FlyerBrandDefaults {
  return {
    businessName: defaults.businessName || "4 Nerds",
    instagramHandle: defaults.instagramHandle || "",
    tagline: pokemonOnlyText(defaults.tagline || defaultFlyerBrandDefaults.tagline),
    cta: pokemonOnlyText(defaults.cta || defaultFlyerBrandDefaults.cta),
    defaultFlyerStyle: pokemonOnlyText(defaults.defaultFlyerStyle || defaultFlyerBrandDefaults.defaultFlyerStyle),
    preferredColors: defaults.preferredColors || defaultFlyerBrandDefaults.preferredColors,
    preferredLayout: withFourByFive(defaults.preferredLayout || defaultFlyerBrandDefaults.preferredLayout),
    brandingNotes: pokemonOnlyText(defaults.brandingNotes || defaultFlyerBrandDefaults.brandingNotes)
  };
}

function pokemonOnlyText(value: string) {
  const pokemonTcgToken = "__POKEMON_TCG__";
  return value
    .replace(/Pokémon TCG|Pokemon TCG/gi, pokemonTcgToken)
    .replace(/\bTCG\b/gi, "Pokémon TCG")
    .replace(new RegExp(pokemonTcgToken, "g"), "Pokémon TCG")
    .replace(/One Piece|Lorcana|Yu-Gi-Oh|sports cards|anime collectibles|collectibles in general|collectibles|collectible/gi, "Pokémon cards")
    .replace(/trading cards|trading card convention/gi, "Pokémon cards")
    .replace(/buying, selling, and trading(?! Pokémon cards| Pokemon cards)/gi, "buying, selling, and trading Pokémon cards")
    .replace(/Pokemon/g, "Pokémon")
    .replace(/\s+/g, " ")
    .trim();
}

function withFourByFive(value: string) {
  const clean = pokemonOnlyText(value);
  return /4:5/.test(clean) ? clean : `${clean}, 4:5 aspect ratio`;
}

function organizerLine(event: Event, options: FlyerPromptOptions) {
  const handle = eventHostHandle(event);
  if (!options.includeOrganizerHandle || !handle) return "";
  return `Include organizer/event handle ${handle} in small text if useful.`;
}

function eventHostHandle(event: Event) {
  return normalizeHandle(event.organizerInstagramHandle || event.locationInstagramHandle);
}

function normalizeHandle(value?: string) {
  if (!value) return "";
  const clean = value.trim();
  if (!clean || clean.toLowerCase() === "unknown") return "";
  return `@${clean.replace(/^@+/, "")}`;
}

function locationSummary(event: Event, includeAddress: boolean) {
  const cityState = [event.city, event.state].filter(Boolean).join(", ");
  const compact = [event.venueName, cityState].filter(Boolean).join(" in ") || event.address || "the event location";
  if (!includeAddress) return compact;
  return [event.venueName, event.address, cityState].filter(Boolean).join(", ") || compact;
}

function datePhrase(event: Event) {
  const days = eventDays(event);
  if (days.length === 1) return `on ${format(parseISO(days[0].date), "EEEE, MMMM d")}`;
  return `on ${dateRangeSummary(event)}`;
}

function timeSummary(event: Event) {
  const days = eventDays(event);
  const withTimes = days.filter((day) => day.startTime || day.endTime);
  if (!withTimes.length) return "use the saved event date and keep time optional";
  return withTimes.map((day) => formatEventDay(day)).join("; ");
}

function attendanceText(event: Event, workers: Worker[]) {
  const days = eventDays(event);
  const attendingDays = attendedDays(event, workers);
  if (days.length === 1) return `We will be attending ${format(parseISO(days[0].date), "EEEE")} only`;
  if (attendingDays.length === days.length) return `We will be attending all ${days.length} days`;
  if (attendingDays.length === 0) return `We will be attending the event`;
  const names = attendingDays.map((day) => format(parseISO(day.date), "EEEE"));
  return `We will be attending ${joinNatural(names)}`;
}

function attendedDays(event: Event, workers: Worker[]) {
  const days = eventDays(event);
  if (event.eventDayWorkers?.length) {
    const availableDayIds = new Set(event.eventDayWorkers.map((row) => row.eventDayId));
    return days.filter((day) => availableDayIds.has(day.id));
  }
  const summaries = availabilitySummaryByWorker(event, workers);
  return summaries.length || event.confirmedWorkerIds?.length ? days : days;
}

function joinNatural(items: string[]) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
