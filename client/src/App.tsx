import React from 'react';
import TileCanvas from './components/Canvas/TileCanvas';
import RoomPanel from './components/Controls/RoomPanel';
import TilePanel from './components/Controls/TilePanel';
import OptimizationPanel from './components/Controls/OptimizationPanel';
import StatsPanel from './components/Controls/StatsPanel';
import ProjectPanel from './components/Controls/ProjectPanel';
import { useLayoutWorker } from './hooks/useLayoutWorker';

export default function App() {
  // Initialize worker — auto-computes on state changes
  useLayoutWorker();

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight text-white">
            TileFlow
          </h1>
          <span className="text-[10px] text-gray-500 font-mono bg-gray-800 px-2 py-0.5 rounded">
            v1.0
          </span>
        </div>
        <p className="text-xs text-gray-500">
          Real-time tile layout optimizer
        </p>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 flex-shrink-0 overflow-y-auto p-4 space-y-4 bg-gray-950 border-r border-gray-800">
          <ProjectPanel />
          <RoomPanel />
          <TilePanel />
          <OptimizationPanel />
          <StatsPanel />
        </aside>

        {/* Canvas area */}
        <main className="flex-1 relative overflow-hidden">
          <TileCanvas />
        </main>
      </div>
    </div>
  );
}
