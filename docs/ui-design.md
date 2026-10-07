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
