# Pokémon scanner engineering audit

## Checkpoints

- Pre-audit checkpoint: `6544ec59`
- Consolidated camera/crop/mobile phase: `55c9258f`
- OCR, matching, pricing, bulk, and test phase: `8538a9b8`
- No destructive SQL or data mutation was run.

## Scanner surface

| Surface | Current responsibility |
| --- | --- |
| `src/pages/HomePage.tsx` | Floating camera shortcut to `/sales?mode=sale&initialMode=camera`. |
| `src/pages/SalesControlPage.tsx` | The one camera implementation for Add Sale and Add Purchase; owns capture, gallery, camera switching, compression, previews, and normal Save. |
| `src/components/sales/CardScanPanel.tsx` | Crop-quality review, manual four-corner adjustment, Analyze/Cancel, candidate confirmation, manual API search, technical OCR details, and applying suggestions to the unsaved form. |
| `src/components/sales/BatchInventoryImporter.tsx` | Separate per-image draft queue, mobile/desktop concurrency limit, review, exact-card confirmation, finish, condition, and per-card actual cost. |
| `src/services/sales/cardImageProcessor.ts` | Lazy image-worker lifecycle, cancellation, automatic detection, perspective crop, and older-browser bounding-box fallback. |
| `src/workers/cardImageWorker.ts` | Downscaled edge detection and perspective warp off the main thread. |
| `src/services/sales/cardScanService.ts` | One reusable lazy Tesseract worker, sequential region OCR, timeouts, Pokémon TCG API queries/ranking, confirmation, and TCGplayer price retrieval. |
| `src/services/sales/cardScanParsing.ts` | OCR normalization, Pokémon-name dictionary correction, suffix preservation, collector-number parsing, sticker parsing, fuzzy/token similarity, and ranking reasons. |
| `src/components/sales/TcgplayerPricingPanel.tsx` | Finish selection, market/low/mid/high/direct-low display, update/check dates, and 75/80/custom targets. |
| `src/services/database/inventoryPurchaseRepository.ts` | Canonical Supabase read/write mapping, including scanner and price-provenance fields. |
| `src/services/images/saleImageService.ts` | Type validation, 1,800-pixel compression limit, and Supabase Storage upload on normal Save. |
| `src/components/GlobalErrorBoundary.tsx`, `src/services/startupRecovery.ts`, `src/services/pwa/registerPwa.ts` | App-shell recovery, stale chunk recovery, cache clearing, and prompted PWA updates. |

## Root causes found

1. Two camera/scanner UIs could own independent media streams. The inline panel also started OCR automatically when an image changed.
2. Automatic crop used remote OpenCV but was disabled on coarse/mobile devices, precisely where it was most needed. Crop failure sent the full desk/background to OCR.
3. OCR ran a full-card pass before targeted regions and repeated threshold passes even when the first pass was already useful.
4. Cancellation was inconsistent and an in-flight Tesseract recognition could outlive its UI. A Strict Mode cleanup race could also cancel a replacement crop request.
5. API search launched several requests together, did not use the caller abort signal, exposed no ranking reasons, and had no manual result search.
6. The optional visual matcher had no installed card index, but still produced a 549 KB transformer chunk and a 23.6 MB WASM asset and would require a separate model download.
7. An unused paid OpenAI Edge Function remained in source despite the default PWA not calling it.
8. `scan_result` was mapped but omitted from the inventory SELECT, so saved technical scan data was not read back.
9. Two files contained the same scanner migration. `card-scanner-schema-sync.sql` is now the canonical additive scanner migration.

## Selected free architecture

1. Camera/gallery capture and bounded JPEG compression.
2. Local card-edge detection in a lazily loaded worker.
3. Crop-quality review with four draggable corners or full-image fallback.
4. Worker-based perspective correction and portrait normalization.
5. One lazy Tesseract worker; top, collector-number, sticker/label, then full fallback only when needed.
6. Local normalization and Pokémon dictionary/fuzzy candidate generation.
7. At most three selected-field Pokémon TCG API v2 queries, sequentially stopped when enough records exist.
8. Ranked official images with score and evidence; no first-result auto-selection.
9. Explicit **Use This Card**, then TCGplayer finish selection and pricing.
10. Suggestions apply only to the draft; the user still presses the existing Save button.

The Pokémon TCG API searches card records; it does not analyze images.

## Visual matching decision

Artwork embeddings are not practical for this PWA today. A useful implementation would require a large model plus a maintained embedding index for thousands of cards. The prior code did neither reliably and was inappropriate for mobile memory. It was removed. Crop + OCR + collector number + fuzzy API ranking is the honest low-memory default.

## Database fields preserved

`card_name`, `collector_number`, `card_set`, `card_language`, `card_condition`, `sticker_price`, `grading_company`, `grade`, `certificate_number`, `front_image_url`, `front_image_path`, `back_image_url`, `back_image_path`, `scan_confidence`, `scan_status`, `image_hash`, `scan_result`, `market_price_source`, `market_price_variant`, `market_price_updated_at`, and `market_price_checked_at`.

No new field is required. If an older Supabase project lacks scanner fields, run `card-scanner-schema-sync.sql`; if it lacks pricing provenance, run `tcgplayer-pricing-schema-sync.sql`. Both are additive and repeatable.

## Repeatable verification matrix

No real scanner sample images were present in the repository or attachment, so no claim is made that real-photo OCR is fully solved.

| Case | Available check | Required follow-up |
| --- | --- | --- |
| Noisy Charizard text | Automated parser test proves `re Charizalo iT` becomes `Charizard ex`. | Run a clear real Charizard ex photo and record correct-card rank/time. |
| Collector numbers | Automated tests cover `106/094`, `025/165`, `SV107/SV122`, `TG01/TG30`, and `GG44/GG70`. | Verify each from a real photograph. |
| NM / price sticker | Automated tests cover NM/LP and `$27`, `$27.00`, `27$`. | Verify a real visible sticker; do not infer condition without text. |
| Glare / angle / far card | Quality and crop recovery UI implemented. | Supply real images and record crop success, raw OCR, rank, time, and device memory. |
| Slab front/back | Separate label/back OCR path and raw-price warning implemented. | Supply slab front/back images and confirm label/certificate behavior. |
| Bulk isolation | Separate IDs, files, scans, previews, costs, and review states are enforced in code. | Run multiple real images on one Android and one desktop browser. |

## Exact local tests performed

- `npm run test:scanner`: 5 tests, all passing.
- `npm run build`: TypeScript and Vite production build passing.
- 390×844 browser viewport: dashboard loaded; floating shortcut opened Add Sale directly in live-camera mode.
- Camera modal: cancel, gallery, centered shutter, switch-camera, and manual fallback controls were present.
- Camera cancel exposed Take Photo, Upload, Paste Image, and Continue Without Photo; no save occurred.
- Local PNG upload reached crop review with four handles, Analyze Selected Crop, Use Full Image, and manual search.
- That interaction exposed the Strict Mode worker-cancellation race; the lifecycle was corrected and the production build rerun.
- PWA build precache excludes scanner service, crop worker, OCR, scanner panel, pricing panel, and bulk scanner chunks.
- Build comparison: the former 23.6 MB ONNX WASM and 549 KB transformer scanner chunk are gone.

Not performed here: physical Android/iPhone camera capture, real-photo OCR accuracy, device memory profiling, or a real slab scan. Those require actual devices and representative images.
