# TileFlow

A real-time tile layout optimizer that helps users plan tile installations by defining room dimensions, choosing tile sizes and laying patterns, and automatically finding the optimal tile placement to minimize waste and maximize cut piece sizes.

![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=black)
![Express](https://img.shields.io/badge/Express-4.19-000000?logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5.14-2D3748?logo=prisma&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss&logoColor=white)

---

## Features

- **5 Tile Patterns** — Grid, ½ Offset (brick bond), ⅓ Offset, Herringbone, and 45° Diagonal
- **5 Unit Systems** — mm, cm, m, inches, and feet with real-time conversion
- **Two-Phase Hybrid Optimizer** — Coarse scan + fine refinement to find the best tile offset, evaluated with a configurable scoring function: `score = (α × minCutNorm) − (β × waste%)`
- **Interactive 2D Canvas** — Color-coded tiles (blue = full, orange = cut) rendered with react-konva, with zoom, pan, and drag-and-drop tile editing
- **Web Worker Computation** — Geometry engine runs off the main thread with debounced auto-recompute (150ms) for a responsive UI
- **Live Statistics** — Full/cut tile counts, waste percentage, smallest cut piece area, optimization score, and computation time
- **Project Persistence** — Save and load projects via a REST API backed by PostgreSQL

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Client** | React 18, Vite, Zustand, react-konva (Konva), Tailwind CSS |
| **Server** | Express, Prisma ORM, PostgreSQL, Zod validation |
| **Geometry Engine** | Pure TypeScript — framework-independent, runs in browser, Web Worker, or Node.js |
| **Monorepo** | npm workspaces with 4 packages |

---

## Architecture

```
tileflow/
├── packages/
│   ├── geometry/        # Pure TS geometry engine (patterns, clipping, optimization, types)
│   └── worker/          # Web Worker entry point — runs geometry off the main thread
├── client/              # React + Vite SPA
│   └── src/
│       ├── components/  # Canvas (react-konva), Control panels
│       ├── hooks/       # useLayoutWorker — Worker lifecycle + auto-recompute
│       ├── store/       # Zustand state management
│       └── api/         # REST client for project persistence
└── server/              # Express REST API
    ├── prisma/          # PostgreSQL schema (Project, Room, TileConfig, SavedLayout)
    └── src/             # Routes, middleware, Zod validation
```

The **geometry engine** (`@tileflow/geometry`) is a standalone package with zero framework dependencies. It exports:

- **Pattern generators** — produce tile polygon grids for each pattern type, accepting `(offsetX, offsetY)` that the optimizer varies
- **Sutherland-Hodgman polygon clipping** — clips tiles against the room boundary with AABB fast-reject/accept for performance
- **Two-phase optimizer** — coarse grid scan at half-tile steps, then fine refinement around the best candidate
- **Math utilities** — Shoelace formula (polygon area), 2D rotation, AABB overlap, bounding box computation

---

## Optimization Algorithm

The optimizer searches for the best `(offsetX, offsetY)` to shift the tile grid within one full tile period:

1. **Phase 1 — Coarse Scan**: Samples offsets at large increments (default: 0.5× tile unit) across one full tile period in X and Y
2. **Phase 2 — Fine Refinement**: Zooms into the neighbourhood of the best coarse candidate and re-samples at finer steps (default: 0.1× tile unit)

**Scoring**:
```
score = (α × normalizedMinCutArea) − (β × wastePercentage)
```
- `α` (default 0.7) — Prefers larger minimum cut pieces (easier to install)
- `β` (default 0.3) — Penalizes material waste

Tile slivers with <1% coverage ratio are automatically discarded.

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- PostgreSQL database

### Installation

```bash
# Clone the repo
git clone https://github.com/gman215/TileFlow.git
cd TileFlow

# Install all workspace dependencies
npm install

# Set up the database
cp server/.env.example server/.env   # add your DATABASE_URL
npm run db:generate
npm run db:push
```

### Development

```bash
# Start client (Vite on :5173) and server (Express on :3001) concurrently
npm run dev
```

### Build

```bash
npm run build
```

---

## Database Schema

| Model | Description |
|---|---|
| **Project** | Top-level entity with name and timestamps |
| **Room** | 1:1 with Project — width, height (mm), display unit preference |
| **TileConfig** | 1:1 with Project — tile dimensions, grout, pattern, α/β weights |
| **SavedLayout** | Many per Project — serialized layout result, config snapshot, score, optional label |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create a new project |
| `GET` | `/api/projects/:id` | Get a project with room, tile config, and layouts |
| `PUT` | `/api/projects/:id` | Update a project |
| `DELETE` | `/api/projects/:id` | Delete a project |
| `GET` | `/api/projects/:id/layouts` | List saved layouts for a project |
| `POST` | `/api/projects/:id/layouts` | Save a layout snapshot |
| `GET` | `/api/health` | Health check |

All request bodies are validated with **Zod** schemas.
