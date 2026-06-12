import * as ical from "node-ical";

type ApiRequest = {
  method?: string;
  query: { url?: string | string[] };
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: CalendarFeedResponse) => void;
};

type CalendarFeedResponse = {
  success: boolean;
  events?: Array<{
    uid: string;
    title: string;
    description?: string;
    location?: string;
    start: string;
    end?: string;
    allDay: boolean;
    url?: string;
  }>;
  error?: string;
};

type ParsedEvent = {
  type?: string;
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: Date;
  end?: Date;
  datetype?: string;
  url?: string | { val?: string };
};

const maxFeedBytes = 5_000_000;
const userAgent = "Mozilla/5.0 (compatible; 4NerdsCalendarImporter/1.0)";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Only GET requests are supported." });
  }

  const rawUrl = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  const sourceUrl = validateUrl(rawUrl);
  if (!sourceUrl) {
    return res.status(400).json({ success: false, error: "A valid public http or https ICS URL is required." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetchPublicCalendar(sourceUrl, controller.signal);

    if (!response.ok) {
      return res.status(200).json({ success: false, error: `Calendar feed returned ${response.status}.` });
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxFeedBytes) {
      return res.status(200).json({ success: false, error: "Calendar feed is too large to import." });
    }

    const text = await response.text();
    if (text.length > maxFeedBytes || !text.includes("BEGIN:VCALENDAR")) {
      return res.status(200).json({ success: false, error: "The URL did not return a valid ICS calendar." });
    }

    const parsed = ical.sync.parseICS(text);
    const now = Date.now();
    const events = (Object.values(parsed) as unknown[])
      .filter((raw) => {
        const item = raw as ParsedEvent;
        return Boolean(item && item.type === "VEVENT" && item.start);
      })
      .map((raw) => {
        const item = raw as ParsedEvent;
        return {
        uid: String(item.uid || `${item.summary || "event"}-${item.start?.toISOString()}`),
        title: clean(item.summary) || "Untitled event",
        description: clean(item.description) || undefined,
        location: clean(item.location) || undefined,
        start: item.start!.toISOString(),
        end: item.end?.toISOString(),
        allDay: item.datetype === "date" || Boolean((item.start as Date & { dateOnly?: boolean }).dateOnly),
        url: typeof item.url === "string" ? item.url : item.url?.val
        };
      })
      .filter((item) => new Date(item.end || item.start).getTime() >= now - 86_400_000)
      .sort((a, b) => a.start.localeCompare(b.start));

    return res.status(200).json({ success: true, events });
  } catch (error) {
    return res.status(200).json({
      success: false,
      error: error instanceof Error && error.name === "AbortError"
        ? "Calendar feed request timed out."
        : error instanceof Error ? error.message : "Could not read this calendar feed."
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPublicCalendar(sourceUrl: string, signal: AbortSignal) {
  let currentUrl = sourceUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      headers: {
        "User-Agent": userAgent,
        Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.5"
      },
      redirect: "manual",
      signal
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    const nextUrl = validateUrl(location ? new URL(location, currentUrl).toString() : undefined);
    if (!nextUrl) throw new Error("Calendar feed redirected to an unsafe URL.");
    currentUrl = nextUrl;
  }
  throw new Error("Calendar feed redirected too many times.");
}

function clean(value?: string) {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function validateUrl(rawUrl?: string) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    if (isBlockedHostname(parsed.hostname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isBlockedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
