# 4 Nerds Event Tracker

Private mobile-first PWA for tracking upcoming Pokemon, TCG, card show, anime, collectibles, and vendor events for the 4 Nerds vendor business.

## What It Does

- Saves organizer/source pages such as card show websites, event pages, Instagram pages, Facebook pages, RSS feeds, and Reddit feeds.
- Checks saved sources to find possible new events instead of relying on manual event entry.
- Tracks upcoming events, source links, organizer details, vendor registration links, registration status, and reminders.
- Keeps scraped/imported candidates in a Review queue before saving them to the calendar.
- Lets users mark events as Interested, Maybe, or Not Going.
- Schedules local reminders for Interested events.
- Stores everything locally on the phone/browser. No login, backend, AI API, or paid API is required.

## Local-First Approach

Data is stored in IndexedDB through Dexie for local mode and cache. If Supabase is configured, Home, Calendar, Review, and Sources pull shared team data from Supabase and cache it locally.

## Team Sync With Supabase

Create a Supabase project, run `supabase-schema.sql` in the SQL editor, then add:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

If those values are missing, the app shows Local Mode and still works locally. For V1 there is no login; each device asks for a user name and saves it locally as `device_user_name`.

Shared tables:

- `events`
- `organizers`
- `sources`
- `review_candidates`
- `event_decisions`
- `app_settings`

Most records are stored as JSON payloads to keep the MVP flexible. `event_decisions` has explicit columns so each person can mark Interested, Maybe, or Not Going. Notifications remain local per device.

## No AI / No Paid APIs

Parsing uses local TypeScript code, regexes, `chrono-node`, and keyword matching. Distance uses OpenStreetMap/Nominatim geocoding only when needed, with local cache and rate limiting. Google Maps is used only as a normal directions deep link.

## Scraping

V1 includes safe, lightweight source adapters:

- Manual Instagram import
- Manual event entry
- Public website scraper
- RSS/Atom reader
- Reddit public JSON feed reader
- Generic public page parser through the website adapter

The app does not scrape private pages, bypass login, bypass CAPTCHA, rotate proxies, or use stealth automation. If a source fails, it records the error and marks the source as needing review.

Public website scraping is real but conservative: the website adapter fetches public HTML, removes scripts/styles, splits the page into likely event blocks, scores each block with the rule-based detector, sends eligible candidates to Review, and stores ignored blocks in scrape logs.

## Instagram Limitation

Unauthorized automated Instagram scraping is intentionally not included. Paste an Instagram post URL and caption text into the Import screen. The app parses the caption locally and stores the Instagram URL as the source link. A future version can add an official Instagram API adapter if appropriate.

## How To Add Sources

Open **Sources**, enter source name, type, URL, default venue/address/city/state, and notes, then tap **Save Source**. Use **Refresh** for one source or **Refresh Sources** for all enabled public sources.

Saved Sources are the main automation system. If **Refresh on app open** is enabled in Settings, the app checks enabled sources when it opens, but only when enough time has passed since the last check. The default interval is 12 hours. The **Refresh Now** button always checks immediately.

When a source finds a possible event, it goes to Review first. If registration looks open, the app can notify you. Instagram links are saved as limited/manual-assisted sources; if captions cannot be read safely, the source shows “Instagram needs caption/text paste.”

Saved source examples:

- Woodbridge Card Show website
- NJ card show event page
- Local Pokemon/TCG organizer Instagram page
- Public Facebook event page
- RSS or Reddit feed

For recurring shows, add default venue/location. If the parser finds a date but no address, it can use the saved source defaults and mark the candidate as medium confidence.

Each source has a detail page with refresh, edit, pasted update import, saved events, and review candidates.

## How To Import Instagram Captions

Open **Home** then **Import Post**. The fastest workflow is **Batch** mode: paste several Instagram post/reel URLs and their copied captions into one box. The app splits the batch locally, previews every detected candidate, and saves eligible items to Review in one tap.

For caption-only batches, separate posts with a line containing `---`. Single-post mode is still available when you only have one post.

This is intentionally not Instagram scraping. The app does not log into Instagram, fetch private content, bypass protections, or automate Instagram browsing.

## Home/Base Address And Distance

Open **Settings**, enter a home/base address, and tap **Save**. The app geocodes the home address and event destinations with Nominatim, caches results, then calculates straight-line distance in miles using the Haversine formula.

## Notifications

Notifications use Capacitor Local Notifications. Android channels are created for:

- `event_reminders`
- `new_events`
- `review_needed`
- `registration_updates`

Interested events schedule reminders 7 days before, 3 days before, 1 day before, and day of event. Times in the past are skipped. If permission is denied, the app still works.

## Build And Run

```bash
npm install
npm run dev
npm run build
```

## PWA Install

The main V1 deployment target is a mobile web app / installable PWA. Deploy the built `dist/` folder to any static host that supports HTTPS.

Android:

- Open the website in Chrome.
- Tap the browser install prompt or menu.
- Choose Install app or Add to Home Screen.

iPhone:

- Open the website in Safari.
- Tap Share.
- Tap Add to Home Screen.

The app can still be used as a normal website. Supabase team sync works across Android browsers, iPhone Safari, installed PWAs, and future APK builds.

## Optional Capacitor Android

The Android project remains available, but APK builds are optional for V1.

```bash
npx cap add android
npx cap sync android
npx cap open android
```

## Export / Import Data

Open **Settings** and use **Export** to download JSON backup. Use **Import** to restore a JSON backup.

## Known Limitations

- Public websites can block browser fetches with CORS. Those sources will fail gracefully and show details.
- Parsing is rule-based and intentionally conservative.
- Full organizer profiles are minimal in V1.
- Distance is straight-line, not driving distance.
- No login or multi-device sync in V1.

## Future Ideas

- Official Instagram API adapter.
- Better duplicate review screen with update-existing flow.
- Optional shared backend for team sync.
- More robust public source parsing templates per organizer.
- CSV export and richer reporting.
