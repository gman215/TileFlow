# 010 — Easier to Use · Tasks

- [x] **T0 — Branch.** `feat/010-ux-onboarding` from up-to-date `main`. (Constitution VIII)
- [x] **T1 — Engine: enclosed regions.** `enclosedRegions(plan)` in `plan/derive.ts`: every closed
      region with an interior point. *Verify:* unit test — rectangle split by a partition → 2. (R4)
- [x] **T2 — Store: auto-rooms, rectangle rooms, templates, help state.** `addWalls` auto-adds rooms
      for unclaimed regions; `addRoomRect`; `loadTemplate`; `helpOpen`. *Verify:* in the browser,
      drawing a partition yields two rooms with no Room-tool click. (R1, R3, R4)
- [x] **T3 — Toolbar + shortcuts.** One top-centre tool pill per mode with icons, labels, undo/redo,
      "Action (Key)" tooltips; global shortcut hook that ignores typing. *Verify:* each key in AC-5.3
      switches tool / undoes in the browser; typing "w" in a field does not. (R5)
- [x] **T4 — Instruction line.** `HintBar` under the toolbar for every tool / selection / state.
      *Verify:* text changes with tool, selection and an empty plan. (R2)
- [x] **T5 — Room rectangle tool.** Drag or two clicks; snapped; live dims; click-inside fallback.
      *Verify:* drag a rectangle next to an existing room → shared wall, new room appears. (R3)
- [x] **T6 — Start card + help.** First-run card with three starts and the four examples; ? reopens
      it with shortcuts; dismissal persisted (try/catch). *Verify:* every example loads; reload
      doesn't reshow; ? shows it. (R1)
- [x] **T7 — Sidebar.** Numbered steps, Selected first, advanced disclosure, Shape explanations, AI
      disclosure, ⓘ tips. *Verify:* screenshot review. (R6)
- [x] **T8 — Canvas clearances.** Fit padding for chrome; collapsible stats card; studs at 8 px.
      *Verify:* fitted room's corners all visible; collapsed card persists. (R7)
- [x] **T9 — Close-out.** README, ROADMAP; `npm test`, typechecks, build; 008/009 browser regression
      scripts still pass.
