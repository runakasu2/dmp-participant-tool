# DMP DATA UI

## Reference and scope

Reference: `/Users/yu/Desktop/戦績管理ツール/dm-records/public/` (`styles.css`, `index.html`, `js/app.js`, `js/ui.js`).
The reference project is read-only. Its CSS was not copied wholesale.

The original app had a 900px-wide single panel, horizontally scrolling navigation, tables with 540–700px minimum widths, and mostly horizontal forms. Existing screens are switched using element IDs and inline `display`; data renderers retain the existing rows, selects, save handlers, and API requests.

## Shared design rules

- Navy navigation `#132339`; page background `#f4f7fa`; white surfaces; text `#203047`.
- Green primary actions `#16876d` and mint selected navigation. Muted text is darkened to `#596b80` for legibility.
- Thin `#e5ebf1` borders, 11px cards / 8px controls, restrained shadow, 8/16/24/32px spacing tokens.
- System Japanese font stack, restrained headings, numeric summary cards, white secondary actions and explicit focus outlines.
- Controls at least 44px high; on phones, primary controls are 48px and inputs use 16px text.

## Layout

- Above 1200px: 224px sidebar; wide workspace (content capped at 1440px); intake and tournament facts in two columns; tabular participant/results lists.
- At 1200px: 200px sidebar, reduced padding, two-column tournament gallery.
- At 1000px: 180px sidebar; participant/results/history/memo rows reflow into labeled cards; summary metrics use two columns. Form rows wrap on tablets.
- At 720px: sidebar becomes a 72px bottom navigation with safe-area padding. Four primary screens and an Other disclosure contain all six original navigation buttons. The live matching roster is the exception to card reflow: at 720px and below it uses compact table rows, with inline save-state badges. Archive tables retain their cards. Inputs and filters stack; tournament gallery uses one column.
- Mobile card labels are derived from the actual table headers, including the changing TCG/non-TCG columns. Existing DOM controls are neither cloned nor replaced.
- The Other disclosure supports Escape, outside-click closing, focus return, and closing after navigation. Page transitions update `aria-current`, breadcrumb, and heading focus.

## Files and data boundaries

- `index.html`: application shell, form groups, labels, result metadata, new presentation script.
- `style.css`: tokens, shared components, existing feature-specific styles, responsive layouts.
- `workspace-ui.js`: navigation accessibility, table-card labels, empty states, message styles. No API calls or storage.
- `deck-trend-ui.js`: viewport-sized chart drawing and date label spacing; point data and aggregation remain unchanged.
- `script.js`: presentation of existing prediction totals, result name/date and saved deck labels; participant loading/error feedback. Computation, URL parsing, request payloads and save behavior stay with the existing functions.
- Backend files, dependencies, migrations and database schema are unchanged.

## Validation

Run the normal suite:

```sh
node --test tests/*.test.js
```

Optional browser smoke test (separate test dependency, not installed in this project):

```sh
npm install --prefix /tmp/dmp-ui-validation --no-audit --no-fund playwright
NODE_PATH=/tmp/dmp-ui-validation/node_modules node tests/workspace-ui.browser.cjs
```

The browser test launches isolated headless Chrome (`CHROME_EXECUTABLE` can override the macOS default), serves only local static files, and intercepts **all** API requests with synthetic fixtures. It never connects to a production database. Screenshots go to `/tmp/dmp-ui-screenshots` or `UI_SCREENSHOT_DIR`.

It checks 375, 390, 430, 768 and 1440px widths, including long names, date/URL forms, empty state, prediction/result saves, numeric summaries, chart views, player search/detail, tournament catalogue/detail, deck editing, TCG live memos and archive columns. It checks page/element overflow, bottom navigation clearance, Escape/focus behavior, request payloads, runtime errors, and recovery after a failed participant fetch.

Limitations: browser automation uses desktop Chromium, not physical iOS/Android devices or screen readers. Existing native alerts/confirmation dialogs are retained. Live external acquisition and production writes are intentionally not part of visual verification. The participants API does not provide event name/date, so that screen displays its available IDs; the results screen displays the name/date already returned by its API.

## Results (2026-10-07)

- Normal suite: 164 passed, 0 failed.
- Browser suite: 14 screen states × 5 widths (70 layout checks), with mocked API operation checks.
- All original HTML IDs preserved without duplicates; JavaScript syntax and `git diff --check` pass.
- Screenshots reviewed for desktop, phone and tablet, including saved-deck controls and both chart types.
- No page-level horizontal overflow or runtime errors found within the tested fixture states.
- Future enhancements: a shared in-page notification/confirmation component instead of native dialogs, and filtering/collapsing rows for very large rosters.

## Compact live matching roster

Only `.memo-live-table` at 720px and below reverts to a fixed-layout table. Typical rows are 54–56px high, names wrap, and long deck selections remain inside their column. Existing table-group borders and alternating backgrounds are retained. TCG uses three columns; providers with DMP IDs retain four columns. Saved status is an inline check, empty status a dash, and saving status an ellipsis; full status text remains in the live region and title. Errors and unmatched saved decks retain readable text rather than being reduced to an icon. Desktop/tablet layout, archives, API payloads and saving logic are unchanged.

Validation: 164 normal tests pass; browser checks pass at 375/390/430px for three- and four-column rosters, inline saved badges and compact row heights, plus the existing five-width screen/operation regression suite.

## Phone information density follow-up

At 720px and below:

- Hide only the participants page's `#event-info` with CSS. All IDs, values, URL parsing and acquisition stay intact; the card remains visible on tablet/desktop.
- Reduce the vertical padding in prediction, tournament and period distribution tables to 6px without reducing the text size.
- Use the shared `.deck-pie` layout for prediction distribution, tournament detail distribution and period distribution: chart on the left, legend on the right. Use a 60:40 chart/legend width ratio (excluding a 10px gap), 10×14px thumbnails and 12px legend text. `deck-pie.js` switches only the SVG viewport at the same breakpoint, including on resize, preserving slices, labels, grouping and totals. Desktop viewport and layout are unchanged.
- Compact only `#participant-list`: direct name heading, inline ID label, plain history rows (full dates retained), compact prediction summary, select/save on the same row, and a secondary text-style auto-reset control. All controls retain at least 44px targets. Existing DOM nodes and event handlers stay in place.

Measured with the same two test players and three histories each:

| Width | Before (px/player) | After (px/player) |
| --- | --- | --- |
| 375 | 766 / 714 | 358 / 314 |
| 390 | 759 / 714 | 358 / 314 |
| 430 | 737 / 714 | 339 / 314 |
| 768 | 733 / 710 | 733 / 710 |
| 1440 | 247 / 247 | 247 / 247 |

Normal tests: 164 passed. Browser suite covers all five widths, all three distribution components, a long nine-entry legend with thumbnail images, responsive viewport switching, manual save and auto reset, and the prior memo/player/result operations. Live APIs and physical iOS/Android devices were not used. Long native-select options are abbreviated in the closed control; the current prediction and history text remain readable above it. A long legend can still make its panel tall because no entries are removed or hidden.

### Chart-first mobile distribution layout

The shared `.deck-pie` phone grid now uses `minmax(0,3fr) minmax(0,2fr)` with a 10px gap. SVG regions stay square and retain their 240×240 viewBox. Long deck names wrap within the legend and cannot change the column ratio. The three distribution views share this CSS; no chart generation, totals, API or desktop layout changed in this adjustment. At 375/390/430px, the chart region is approximately 179/188/212px wide and the legend 120/126/142px (depending on the surrounding panel). Compared with the previous 36:64 split, the chart is about 68% wider.

## Tournament catalogue search and compact filters

- `events-name-search` performs immediate Japanese substring matching against the last successful `/api/events` response's `event_name`. Matching normalizes NFKC, case and surrounding whitespace. It preserves object data and response order and never sends a request on input.
- The existing format/date API filter remains authoritative. A date apply fetches the selected range and then applies the current name query locally. Reset clears name/start/end and reloads all dates within the selected format. The name query is session UI state; it is not added to the API or URL.
- Visible rows and the deletion controller are rebuilt together on name filtering. This exits deletion selection and prevents invisible matches from remaining selected. During fetches the old cache is cleared; the response uses the latest name input. A failed fetch cannot restore stale cached events via a name edit.
- `reload-events` is retained with its original handler and controller references, but hidden using the HTML `hidden` attribute at every viewport.
- Above 1200px, the form is one row: wider name input, two dates, apply and reset. At 721–1200px the name spans the first row. At 720px and below the name uses full width, dates use two columns, and actions share the last row. Phone form height is approximately 243px at 375/390/430px, with date input widths approximately 154/161/181px. All rules are scoped to the catalogue.
- Period summary/trend tools and the format explanation are in a collapsed disclosure. Their existing IDs and click handlers remain intact. Analysis still covers the selected dates/format, independent of the local name query, which the disclosure explains.
- Tests: 165 normal tests pass. Browser checks cover 375/390/430/768/1440px, name-only and each date combination, Japanese names, empty results, clearing, full reset, unchanged order, no name-input network requests, and clearing deletion selection on filtering. Existing screen/operation smoke checks also pass with mock APIs. No DB/API/schema changes.
