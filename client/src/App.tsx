import React from 'react';
import TileCanvas from './components/Canvas/TileCanvas';
import RoomPanel from './components/Controls/RoomPanel';
import ShapePanel from './components/Controls/ShapePanel';
import TilePanel from './components/Controls/TilePanel';
import OptimizationPanel from './components/Controls/OptimizationPanel';
import StatsPanel from './components/Controls/StatsPanel';
import ProjectPanel from './components/Controls/ProjectPanel';
import { useTileFlowStore } from './store/tileFlowStore';
import { useProjectActions } from './hooks/useProjectActions';
import { useLayoutWorker } from './hooks/useLayoutWorker';
import type { MeasurementSystem } from './utils/measurements';

const SYSTEMS: { value: MeasurementSystem; label: string }[] = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial' },
];

/** 2×2 tile-grid logo mark. */
function LogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <rect x="0" y="0" width="22" height="22" rx="5" fill="#1B1B19" />
      <rect x="5" y="5" width="5" height="5" rx="1" fill="#8FB3D9" />
      <rect x="12" y="5" width="5" height="5" rx="1" fill="#FFFFFF" />
      <rect x="5" y="12" width="5" height="5" rx="1" fill="#FFFFFF" />
      <rect x="12" y="12" width="5" height="5" rx="1" fill="#E0A074" />
    </svg>
  );
}

function UnitToggle() {
  const system = useTileFlowStore((s) => s.system);
  const setSystem = useTileFlowStore((s) => s.setSystem);

  return (
    <div className="flex rounded-lg overflow-hidden border border-hairline">
      {SYSTEMS.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => setSystem(value)}
          className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
            system === value
              ? 'bg-ink text-white'
              : 'bg-[#F0EFEB] text-[#57554F] hover:bg-hairline'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  // Initialize worker — auto-computes on state changes
  useLayoutWorker();

  const projectName = useTileFlowStore((s) => s.projectName);
  const { saving, projectId, handleSave } = useProjectActions();

  return (
    <div className="flex flex-col h-screen bg-shell">
      {/* App bar */}
      <header className="flex items-center justify-between h-14 px-4 bg-white border-b border-hairline shrink-0">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-[15px] font-bold tracking-tight text-ink">
            TileFlow
          </span>
          <span className="text-ink-muted text-sm select-none">/</span>
          <span className="text-sm text-ink-secondary truncate max-w-[220px]">
            {projectName}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <UnitToggle />
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary py-1.5"
          >
            {saving ? 'Saving…' : projectId ? 'Save' : 'Create'}
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — grouped sections split by hairline dividers */}
        <aside className="w-[312px] flex-shrink-0 overflow-y-auto bg-white border-r border-hairline divide-y divide-divider">
          <RoomPanel />
          <ShapePanel />
          <TilePanel />
          <OptimizationPanel />
          <ProjectPanel />
        </aside>

        {/* Canvas area */}
        <main className="flex-1 relative overflow-hidden bg-stage">
          <TileCanvas />
          {/* Floating stats card (bottom-left over the stage) */}
          <StatsPanel />
        </main>
      </div>
    </div>
  );
}
