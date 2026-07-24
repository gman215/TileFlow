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
        },
        tileConfig: {
          width: tileConfig.width,
          height: tileConfig.height,
          grout: tileConfig.grout,
          pattern: tileConfig.pattern,
          alpha: optimizationConfig.weights.alpha,
          beta: optimizationConfig.weights.beta,
        },
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
      setProjectId(latest.id);
      setProjectName(latest.name);

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
          });
        } else {
          // Back to a plain rectangle first — width/height are read-only while
          // an outline is in place.
          store.setRoomShape(undefined);
          store.setRoomWidthMM(latest.room.width);
          store.setRoomHeightMM(latest.room.height);
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
