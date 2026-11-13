import { useState } from 'react';
import { useTileFlowStore } from '../store/tileFlowStore';
import { api } from '../api/client';
import { systemForUnit } from '../utils/measurements';

/**
 * Save / load logic for the current project, shared by the header Save
 * button and the sidebar ProjectPanel. Purely a presentation-layer helper —
 * it reads/writes the existing store and API client only.
 */
export function useProjectActions() {
  const projectId = useTileFlowStore((s) => s.projectId);
  const projectName = useTileFlowStore((s) => s.projectName);
  const setProjectId = useTileFlowStore((s) => s.setProjectId);
  const setProjectName = useTileFlowStore((s) => s.setProjectName);
  const room = useTileFlowStore((s) => s.room);
  const system = useTileFlowStore((s) => s.system);
  const tileConfig = useTileFlowStore((s) => s.tileConfig);
  const optimizationConfig = useTileFlowStore((s) => s.optimizationConfig);
  const alignment = useTileFlowStore((s) => s.alignment);
  const plan = useTileFlowStore((s) => s.plan);
  const boxSizes = useTileFlowStore((s) => s.boxSizes);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const data = {
        name: projectName,
        // Persist a representative unit for the chosen system (dims are in mm)
        room: {
          width: room.width,
          height: room.height,
          unit: system === 'imperial' ? 'feet' : 'm',
          // null rather than undefined so saving a room that used to have an
          // outline actually clears it server-side.
          shape: room.shape ?? null,
          // A point anchor on a plain rectangle (011); null clears an old one.
          anchor: room.anchor ?? null,
        },
        tileConfig: {
          width: tileConfig.width,
          height: tileConfig.height,
          grout: tileConfig.grout,
          pattern: tileConfig.pattern,
          alpha: optimizationConfig.weights.alpha,
          beta: optimizationConfig.weights.beta,
          alignment,
        },
        // In a plan, room/tileConfig above are the active room's; the plan is
        // the source of truth. null clears a plan the project used to have.
        plan: plan ?? null,
        // 012 — pieces per box per tile product; null clears an old value.
        boxes: Object.keys(boxSizes).length > 0 ? boxSizes : null,
      };

      if (projectId) {
        await api.updateProject(projectId, data);
        setMessage('Saved!');
      } else {
        const project = await api.createProject(data);
        setProjectId(project.id);
        setMessage('Created!');
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleLoad = async () => {
    try {
      const projects = await api.listProjects();
      if (projects.length === 0) {
        setMessage('No saved projects');
        setTimeout(() => setMessage(''), 3000);
        return;
      }
      // Load most recent project
      const latest = projects[0];
      // Refuse before adopting its id: a later Save would otherwise overwrite
      // a newer plan with whatever is open now.
      if (latest.plan && ![1, 2].includes((latest.plan as { version?: unknown }).version as number)) {
        setMessage('This project was saved by a newer version of TileFlow.');
        setTimeout(() => setMessage(''), 3000);
        return;
      }
      setProjectId(latest.id);
      setProjectName(latest.name);

      // A project saved before 012 has no box sizes: tiles only (AC-3.4).
      useTileFlowStore.setState({ boxSizes: validBoxes(latest.boxes) });

      const store0 = useTileFlowStore.getState();
      if (latest.plan) {
        if (!store0.loadPlan(latest.plan)) {
          setMessage('This plan could not be opened.');
          setTimeout(() => setMessage(''), 3000);
          return;
        }
        if (latest.room) store0.setSystem(systemForUnit(latest.room.unit as any));
        setMessage(`Loaded: ${latest.name}`);
        setTimeout(() => setMessage(''), 3000);
        return;
      }
      // A single-room project: leave any open plan first.
      if (store0.plan) useTileFlowStore.setState({ plan: null, derived: null, activeRoomId: null, roomLayouts: {}, roomOrigins: {} });

      if (latest.room) {
        // Server stores dimensions in mm
        const store = useTileFlowStore.getState();
        const shape = latest.room.shape;

        // Guard the payload: an outline needs at least a triangle to be a room.
        if (shape && (shape.boundary?.vertices?.length ?? 0) >= 3) {
          store.setRoomShape({
            boundary: shape.boundary,
            holes: shape.holes ?? [],
            referenceWall: shape.referenceWall,
            ...(shape.anchor ? { anchor: shape.anchor } : {}),
          });
        } else {
          // Back to a plain rectangle first — width/height are read-only while
          // an outline is in place.
          store.setRoomShape(undefined);
          store.setRoomWidthMM(latest.room.width);
          store.setRoomHeightMM(latest.room.height);
          if (latest.room.anchor?.kind === 'point') {
            const r = useTileFlowStore.getState().room;
            useTileFlowStore.setState({ room: { ...r, anchor: latest.room.anchor } });
          }
        }
        store.setSystem(systemForUnit(latest.room.unit as any));
      }
      if (latest.tileConfig) {
        const tc = latest.tileConfig;
        useTileFlowStore.setState({
          tileConfig: {
            width: tc.width,
            height: tc.height,
            grout: tc.grout,
            pattern: tc.pattern as any,
          },
        });
        useTileFlowStore.getState().setAlpha(tc.alpha);
        useTileFlowStore.getState().setBeta(tc.beta);
        if (tc.alignment === 'optimize' || tc.alignment === 'center-tile' || tc.alignment === 'center-grout') {
          useTileFlowStore.getState().setAlignment(tc.alignment);
        }
      }
      setMessage(`Loaded: ${latest.name}`);
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  return {
    projectId,
    projectName,
    setProjectName,
    saving,
    message,
    handleSave,
    handleLoad,
  };
}

/** Keep only well-formed entries — a stored value is still outside input. */
function validBoxes(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/^\d+(\.\d)?x\d+(\.\d)?$/.test(k) && typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10000) out[k] = v;
  }
  return out;
}
