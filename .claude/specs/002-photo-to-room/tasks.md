# 002 — Photo/Sketch → Room Outline · Tasks

**Prerequisite:** 001-ai-foundation complete and its verification block passing.

- [x] **T0 — Branch.** Create this spec's branch and switch to it before touching any file:
      `git switch -c feat/002-photo-to-room`, cut from an up-to-date `main`.
      If `001-ai-foundation` is not yet merged to `main`, stop — the dependency rule says this
      spec has not started yet. Do not branch off 001's branch.
      *Verify:* `git rev-parse --abbrev-ref HEAD` prints `feat/002-photo-to-room`, and
      `git status --porcelain` is clean apart from anything you already intended to carry over.
      (Constitution VIII)

- [x] **T1 — Schemas.** Add `ROOM_FROM_IMAGE_JSON_SCHEMA` and the `RoomFromImageOut` Zod mirror to
      `api/_lib/schemas.ts`, plus `RoomFromImageIn` for the request. Zod bounds must be stricter
      than the JSON Schema, and vertex caps must not exceed what `server/src/validation.ts` accepts
      (≤500 boundary vertices, ≤50 holes) so a proposal can never produce an unsaveable room.
      *Verify:* `npm run typecheck:api`; a scratch script proves a 61-vertex boundary and a
      1.5 confidence are both rejected. (AC-2.3, AC-2.6)

- [x] **T2 — Prompt.** Add `ROOM_FROM_IMAGE_V1` to `api/_lib/prompts.ts` covering every point listed
      in `design.md` (coordinate contract, scale strategy, structural-outline-only, holes,
      not-a-plan case, no prose).
      *Verify:* read it against the `design.md` bullet list; all present. The coordinate contract
      (millimetres, origin top-left, x right, y down, boundary clockwise) is stated explicitly, and
      matches the `RoomShape` doc comment in `packages/geometry/src/types/index.ts`. No prompt text
      in `api/ai/`. (AC-2.2)

- [ ] **T3 — Route.** `api/ai/room-from-image.ts`: `POST` only, `readJson(..., 4_000_000)`,
      `checkRateLimit`, demo-mode short-circuit, `interactions.create` with the vision model and
      `response_format`, `RoomFromImageOut.parse(JSON.parse(output_text))`, errors via `toResponse`.
      *Verify:* `curl` a real floor-plan JPEG (base64) → valid JSON matching the schema. `curl` a
      photo of a cat → `confidence: 0` with an explanatory note, not an invented rectangle.
      (AC-2.1, AC-2.5)

- [x] **T4 — Image downscaling.** `client/src/utils/image.ts` exporting `downscaleToJpeg()` with the
      retry ladder (q0.85/1600 → q0.7 → 1200px) before failing.
      *Verify:* feed it an 8 MB 4032×3024 phone photo; the result's longest edge is ≤1600 and
      `base64.length < 4_000_000` — the **encoded** length is what the body cap measures, so check
      that, not the decoded byte count. (AC-1.2, AC-1.3)

- [x] **T5 — Client API + DTO.** Add `roomFromImage()` to `client/src/api/ai.ts` with `AbortSignal`
      support and `AiError` code propagation.
      *Verify:* `cd client && npx tsc --noEmit` clean.

- [x] **T6 — Store proposal state.** Add `shapeProposal`, `setShapeProposal`, `applyShapeProposal`
      to `client/src/store/tileFlowStore.ts`. `applyShapeProposal` **must** call the existing
      `setRoomShape()`, not assign `room` directly.
      *Verify:* apply a proposal, then click the Shape panel's undo (`↺`) — the previous room
      returns in one step. (AC-3.4, AC-3.6)

- [x] **T7 — Ghost rendering.** Extend `client/src/components/Canvas/RoomShapeLayer.tsx` to draw
      `shapeProposal` dashed at ~35% opacity in `#F59E0B`, above the committed room. Reuse the
      existing polygon→flat-points helper.
      *Verify:* with a proposal pending, both outlines are visible and distinguishable; with none,
      the canvas renders exactly as before. (AC-3.1)

- [x] **T8 — Upload UI.** `client/src/components/AI/PlanUpload.tsx`, rendered in `ShapePanel` above
      the Draw/Cut-out buttons. File picker, optional note (≤300 chars), busy state, error line,
      and the proposal summary card: wall count, area, perimeter, confidence, model note, plus the
      "check one wall length" advice. Apply / Discard buttons. Match the existing panel styling
      (`section-header`, `seg`, `btn-primary`, `input-label`) — no new visual vocabulary.
      *Verify:* upload a plan; summary numbers match what `ShapePanel` shows after applying.
      (AC-1.1, AC-1.5, AC-3.3, AC-4.2)

- [x] **T9 — Validation before offering** (`client/src/components/AI/PlanUpload.tsx`).
      Run `validateShape()` on the proposal and list any issues
      in the summary card using the same red-box treatment `ShapePanel` already uses for outline
      issues. Warn prominently when `confidence < 0.4`; do not offer a proposal at all when
      `confidence === 0`.
      *Verify:* a plan whose cut-out escapes the boundary shows the existing hole-outside issue
      before the user can apply. (AC-3.2, AC-3.7, AC-6.2)

- [x] **T10 — Disabled and failure states.** Wire `useAiAvailability()`; disable the control with a
      one-line reason when unconfigured. Handle 429/502/503/offline/abort per the `design.md`
      table, leaving the room untouched in every case.
      *Verify:* run the checks in the verification block below. (AC-5.1–5.4)

- [ ] **T11 — Full spec verification.** Run the block below and record the result.

---

## Verification block

Requires `npm run dev` and a `GEMINI_API_KEY`.

0. **On the right branch** — `git rev-parse --abbrev-ref HEAD` prints
   `feat/002-photo-to-room`, not `main`. (Constitution VIII)
1. **Happy path, dimensioned plan** — upload a floor plan with printed dimensions. The proposal
   appears ghosted; `notes` names the labels it used; applying produces wall lengths within ~5% of
   the printed values. (AC-2.4, R4)
2. **Happy path, sketch** — upload a hand sketch with no dimensions. Confidence ≤ 0.4, the
   low-confidence warning shows, the shape is still right. Retype one wall in the wall table and
   confirm the room stays square. (AC-4.1)
3. **L-shape and cut-out** — upload a plan with an island. The hole comes back, is excluded from
   the area, and the tile count drops accordingly after applying. (AC-6.1)
4. **Not a plan** — upload a photo of anything else → `confidence: 0`, no proposal offered, the
   model's reason shown. (AC-2.5)
5. **Discard** — request a proposal, discard it; room, wall table and stats are byte-identical to
   before. (AC-3.5)
6. **Undo** — apply a proposal, press `↺`; the previous room returns in one step. (AC-3.6)
7. **Big photo** — upload an 8 MB phone photo; it succeeds, and the network tab shows a request
   body under 4 MB. (AC-1.3)
8. **Bad file** — select a PDF or a .txt renamed to .jpg; rejected client-side, no network request.
   (AC-1.4)
9. **Unconfigured** — unset `GEMINI_API_KEY`, restart; the control is disabled with a reason and
   hand-drawing still works fully. (AC-5.3)
10. **Demo mode** — `AI_DAILY_CALL_BUDGET=0`; a canned outline is returned and labelled. (AC-5.4)
11. **Abort** — start an upload and immediately switch panels; no console error, no state update
    after unmount. (AC-5.2)
12. **Types and tests** — `npm run typecheck:api`, `cd client && npx tsc --noEmit`,
    `npm test --workspace @tileflow/geometry` all clean.

---

## Verification record — 2026-09-07

Run against `npm run dev` (the vite AI middleware from 001) on branch
`feat/002-photo-to-room`, plus a headless Chromium driving the real UI.

| # | Item | Result |
|---|---|---|
| 0 | On the right branch | **Pass** — `feat/002-photo-to-room` |
| 1 | Happy path, dimensioned plan | **Blocked** — see *Quota* below |
| 2 | Happy path, sketch | **Blocked** — quota. The low-confidence UI it drives is verified against a stubbed `confidence: 0.25` response: warning shown, figure shown |
| 3 | L-shape and cut-out | **Pass, demo content** — the demo L-shape with an island applies, the hole is excluded from the area (11.94 m² = 128.5 ft²), and the tile count moves 80 → 140. The *model's* reading of an island is unverified (quota) |
| 4 | Not a plan | **Pass, stubbed** — a `confidence: 0` response offers no proposal, ghosts nothing, and shows the model's reason. The *model's* own behaviour on a non-plan image is unverified (quota) |
| 5 | Discard | **Pass** — card gone, ghost gone, room summary byte-identical, no undo entry |
| 6 | Undo | **Pass** — one `↺` restores the previous room exactly |
| 7 | Big photo | **Pass** — a 4032×3024 / 32 MB PNG produced a **0.69 MB** request body |
| 8 | Bad file | **Pass** — a `.txt` renamed `.jpg` is refused client-side with **zero** network requests |
| 9 | Unconfigured | **Pass** — health reports `configured: false`, the control is disabled with a reason, the route returns 503 `config`, and hand-drawing is unaffected |
| 10 | Demo mode | **Pass** — `AI_DAILY_CALL_BUDGET=0` returns the canned outline in 22 ms with `demoMode: true`, labelled in the panel |
| 11 | Abort | **Pass** — tearing the panel down mid-request produces no app error and applies no state |
| 12 | Types and tests | **Pass** — `typecheck:api` clean, `client tsc` clean, 114/114 geometry tests |
| — | Leak check (gate 6) | **Pass** — `git grep --untracked -i "AIza"` returns nothing; nothing key-shaped in `client/dist` |

Also verified on the route itself, without spending a model call: `GET` → 405,
malformed JSON → 400, a `data:` URI prefix → 400 naming the field, a disallowed
mimeType → 400, a body over 4 MB → 413, and an upstream failure → 502 with the
provider's text logged server-side and never returned.

### Quota — what blocks items 1, 2 and the model half of 3 and 4

The `GEMINI_API_KEY` in `.env.local` is on the **free tier**, whose limit for
`gemini-3.8-flash` is **20 requests/day** (`generate_content_free_tier_requests`).
That allowance was spent during this session, so every live call now returns
`429 You exceeded your current quota`. Nothing in this spec's code is implicated:
the failure maps correctly to a 502 with the cause logged and not returned.

**To finish:** wait for the quota to reset (or raise it), then run items 1–4 with
a real plan, a real sketch and a non-plan photo. A generated test plan with known
ground truth — 5.00 × 4.00 m L-shape, 1.80 × 1.50 m notch, 1.60 × 1.00 m island —
is the right instrument for item 1, since it makes the ~5% wall-length tolerance
checkable rather than eyeballed.

### Two findings outside this spec's scope

1. **A provider-side 429 does not fall back to demo mode.** Constitution VII says
   a spent budget should show canned content rather than an error, but that path
   is driven by *our* `AI_DAILY_CALL_BUDGET` counter only. When Google's own quota
   trips first — which is what happens on a free-tier key, and is what happened
   here — the visitor gets "The AI service is unavailable right now." That is the
   exact outcome Constitution VII exists to prevent. Worth deciding deliberately,
   probably in 006.
2. **The canvas does not fit to a proposal.** An outline larger than the current
   room is drawn correctly but extends past the viewport at the current zoom, so
   the user sees part of it. No acceptance criterion covers this; a "fit" on
   proposal would be a small, separate change.
