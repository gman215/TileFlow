# TileFlow vs. the market — gaps for tile installation, and a plan

*Researched 2026-11-08. Competitor features are taken from their own pages and app-store listings
(marketing claims — none were tested hands-on); sources at the end. Industry rules cite TCNA/ANSI
guidance as reported by tile-industry sources.*

## 1. The market in three groups

| Group | Examples | Who it is for | What it is good at |
|---|---|---|---|
| **Tile layout apps** | Tile Layout Pro, TilePlan, tilecalculators.com, TilePro Calculator, Tilerio, Blocklayer | Installers, DIY | Fast layout + counts, wall tiling, printable plans, boxes |
| **Showroom 3D suites** | Ceramic 3D, Maticad DomuS3D / TilePlanner PRO, Tilelook | Retailers, designers | Photoreal 3D, manufacturer catalogues, sales quotes |
| **General CAD / scan** | Chief Architect, NedGraphics Tiling, magicplan, ArchiCAD Wet Area Tool | Designers, remodelers | Whole-house models, LiDAR scans, pattern libraries |

**Nobody covers the installer's whole job.** The apps are quick but shallow (rectangles, a few
patterns, no real optimisation); the 3D suites sell tile but say nothing about cutting or setting
out; general CAD has, in its own users' words, no real tile generator. That gap is TileFlow's
opportunity.

## 2. Where TileFlow is already ahead

No competitor page claimed any of these:

- **A real optimiser** — a scored search for the grid offset that minimises waste and slivers;
  others only let you shift the grid by hand (Tilerio, Blocklayer) or "maximise full tiles".
- **Measured waste from geometry**, not a flat percentage per pattern (tilecalculators uses
  10 / 12 / 15 / 18 % by pattern).
- **Drawn outlines with cut-outs and a reference wall** — Tilerio has no internal holes at all.
- **Floor plans with real wall assemblies**, framing and a full takeoff.
- **AI that stays honest:** photo → room outline, a plain-English assistant, a setting-out brief and
  a materials estimate — every number from the engine.

## 3. What TileFlow is missing for tile installation

Ranked by how often an installer hits it.

### Must-have (competitors have it; installers need it daily)

| Gap | Who has it | TileFlow today |
|---|---|---|
| **Wall tiling** — showers, tub surrounds, backsplashes as elevations with windows, niches and valves; layouts that run continuously round corners | Tile Layout Pro (Walls Mode), tilecalculators, TilePro | **Floors only.** 009 draws wall *framing* elevations, not tile |
| **A dimensioned cut list** — every cut piece measured and labelled, on the plan and as a list | TilePlan ("every piece dimensioned and labeled"); tilecalculators (sliver alert) | Counts and the smallest cut only |
| **Printable set-out sheet / PDF** — the layout with start lines, dimensions, cut list and order | Tile Layout Pro, TilePlan, tilecalculators, TilePro, Blocklayer | **No print or PDF.** The brief can be copied as text |
| **Order by the box** — tiles or ft² per box → boxes to buy | TilePlan, tilecalculators, Blocklayer, Tile Planner | Tiles only (the estimate doesn't do boxes) |
| **More patterns** — basketweave, chevron, windmill/pinwheel, Versailles, hexagon, checkerboard, stacked vertical, ¼ offset, random plank | tilecalculators (13), TilePro (10+), NedGraphics, Tile Layout Pro (hexagon) | 5 patterns |
| **Plank offset rule** — ANSI A108.02 recommends at most a **33 % offset** for long planks (lippage from warpage); >33 % needs mock-up approval | Nobody enforces it — tilecalculators offers ⅓ and ¼ stagger | ½ offset allowed on 48″ planks, no warning |

### Should-have (differentiators an installer would notice)

| Gap | Who has it | Notes |
|---|---|---|
| **Typed grid shift and edge start** — "start one joint in", nudge by 2 in | Blocklayer, tilecalculators, Tilerio | 011 anchors cover feature centring; this is the manual control |
| **Choosable order buffer** — 10 % is wrong for herringbone/diagonal and for attic stock | tilecalculators (10–25 %), TilePlan (10–25 %) | Fixed at 10 % |
| **Offcut reuse** — a cut's leftover used at the opposite wall, lowering the order | Tilerio ("offcuts go where they fit") | Every cut counts as a whole tile |
| **Borders, feature strips, inlays, mixed sizes** in one room | tilecalculators (border); Chief users ask for it | One tile and pattern per room |
| **Shower floors** — centre or linear drain, ¼″/ft slope, cut lines to the drain, curb, niche | Only ArchiCAD's Wet Area Tool, and no tile app | **Open in the whole market** — a strong differentiator |
| **Movement joints** — perimeter and field joints per TCNA EJ171 shown on the plan | Nobody | Perimeter gap exists (008); no field joints |
| **Trim at exposed edges** — Schluter-style profiles by length, placed on the plan | tilecalculators (trim edges on the map) | Estimate has trim as a line, not on the plan |

### Nice-to-have (sales and visuals)

| Gap | Who has it |
|---|---|
| Tile images, colours and grout colour on the plan | tilecalculators, all 3D suites |
| 3D preview | tilecalculators, TilePlan Pro, DomuS3D, Tilelook, Ceramic 3D |
| Branded PDF quote for the customer | TilePlan Pro, TilePlanner PRO |
| LiDAR / AR room capture | magicplan, Tile Planner (AR) |
| DWG/DXF import and export | Tilelook (DWG import) |
| Manufacturer tile catalogues | DomuS3D (600+ brands), Tilelook, Ceramic 3D |

## 4. Where TileFlow does worse

- **It stops at the floor.** The most common installer jobs — showers and backsplashes — are walls.
- **It produces nothing to take to the job.** No print, no PDF, no dimensioned cut list. An
  installer has to screenshot it. Every simple competitor prints.
- **Fewer patterns and tile shapes** than free web calculators (5 vs. 10–13; no hexagon).
- **Ordering is less useful.** Tiles rather than boxes, a fixed 10 %, and no offcut reuse.
- **Desktop-first.** No tablet/phone layout, no offline mode. Installers measure on site;
  TilePlan works offline on iPhone and iPad.
- **Heavy for a tile job.** Floor plans and stud framing are powerful but sit in front of a user
  who only wants to tile one bathroom (010's Start card helps).
- **Flat visuals.** Blue and orange tiles; no tile images or grout colour to show a customer.

## 5. The plan

Ordered by installer value per unit of effort. 011 (layout control — resizable sidebar, inline wall
length, centring on a feature) is already planned and comes first. Each item below becomes a spec
with requirements, design and tasks, in the same format as 001–011.

| # | Spec | What it adds | Why now | Size |
|---|---|---|---|---|
| 012 | **Installer output** | Dimensioned cut list (labels on the plan + table); printable **set-out sheet PDF** (layout, start lines, dimensions, cut list, order, brief); order **by the box** | Closes the "nothing to take to the job" gap; every competitor prints | M |
| 013 | **Patterns & tile shapes** | Basketweave, chevron, windmill/pinwheel, Versailles, hexagon, checkerboard (two colours), stacked vertical, ¼ offset, random plank; **33 % plank-offset warning** (ANSI A108.02) | Cheapest visible gap; the engine's frame + lattice design makes each pattern a generator | M |
| 014 | **Wall tiling** | Tileable walls with openings (window, niche, valve), start/ledger height, continuous layout round corners, wall cut list and counts — reusing 009's elevation view and 011's anchors | Showers and backsplashes are the core installer job | L |
| 015 | **Ordering accuracy** | Choosable buffer with per-pattern defaults; **offcut reuse** in the count; attic stock; boxes per product across floors and walls | Turns the order figure from rule of thumb into a real number | M |
| 016 | **Shower floors & movement joints** | Centre/linear drain, ¼″/ft slope, envelope cut lines to the drain, curb, niche; perimeter and field movement joints shown per EJ171 spacing | **No tile app does this** — the strongest differentiator | L |
| 017 | **Borders & mixed materials** | Border bands, feature strips, inlays/rugs, multiple tile products per room, each in the counts | Common in bathrooms and entryways; Chief users ask for it | L |
| 018 | **On-site use** | Tablet/phone layout and touch, PWA install and offline planning (AI waits for a connection) | Installers measure and check on site | M |
| 019 | **Visuals** | Tile image/colour and grout colour on the plan; customer PDF quote; 3D preview later | Helps sell the job; lower installer value | M–L |
| later | Capture & interchange | LiDAR/AR capture; DWG/DXF import and export; manufacturer catalogues | Large integrations; revisit after 012–018 | L |

**Recommended order:** 011 → 012 → 013 → 014 → 015 → 016 → 017 → 018 → 019.
012 and 013 are the fastest visible wins. 014 and 016 make TileFlow the tool for bathrooms — the
job installers do most — and 016 is something no competitor offers.

## Sources

- Tile Layout Pro — https://thebespokebloke.co.uk/
- tilecalculators.com Tile Layout Planner — https://tilecalculators.com/tile-layout-planner/
- TilePro Calculator — https://tileprocalculator.com/
- Tilerio — https://tilerio.com/
- Blocklayer Tile Fit Floor — https://www.blocklayer.com/tile-fit-floor
- TilePlan (App Store) — https://apps.apple.com/us/app/tileplan-flooring-calculator/id6757448714
- Maticad DomuS3D — https://maticad.com/en/domus3d/features
- Maticad TilePlanner PRO — https://www.maticad.com/?p=1995593
- NedGraphics Tiling — https://www.nedgraphics.com/product/tiling/
- Tilelook — https://landing.tilelook.com/en
- Ceramic 3D (Appvizer) — https://www.appvizer.co.uk/construction/architecture/ceramic-3d
- Chief Architect forum, "tile pattern generator" — https://chieftalk.chiefarchitect.com/topic/6897-tile-pattern-generator/
- magicplan (App Store) — https://apps.apple.com/us/app/magicplan/id427424432
- magicplan review (tile limits) — https://contractortoolstack.com/software/magicplan/
- Graphisoft Wet Area Tool — https://www.graphisoft.com/en-ao/partner-solutions/wet-area-tool/
- Quick Pitch shower estimator (¼″/ft slope) — https://flooringsupplyshop.com/blogs/default/quick-pitch-system-estimator
- CTEF, offsets and the 33 % rule — https://www.ceramictilefoundation.org/blog/offsets-grout-joints-customer-expectations
- Florida Tile installation (>33 % needs mock-up) — https://floridatile.com/installation/
- TileLetter, TCNA EJ171 movement joints — https://www.tileletter.com/?p=36958
