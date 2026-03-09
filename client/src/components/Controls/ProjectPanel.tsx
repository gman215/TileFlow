import React, { useState } from 'react';
import { useTileFlowStore } from '../../store/tileFlowStore';
import { api } from '../../api/client';

export default function ProjectPanel() {
  const projectId = useTileFlowStore((s) => s.projectId);
  const projectName = useTileFlowStore((s) => s.projectName);
  const setProjectId = useTileFlowStore((s) => s.setProjectId);
  const setProjectName = useTileFlowStore((s) => s.setProjectName);
  const room = useTileFlowStore((s) => s.room);
  const unit = useTileFlowStore((s) => s.unit);
  const tileConfig = useTileFlowStore((s) => s.tileConfig);
  const optimizationConfig = useTileFlowStore((s) => s.optimizationConfig);
  const layout = useTileFlowStore((s) => s.layout);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const data = {
        name: projectName,
        room: { width: room.width, height: room.height, unit },
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
        useTileFlowStore.getState().setRoomWidth(latest.room.width);
        useTileFlowStore.getState().setRoomHeight(latest.room.height);
        useTileFlowStore.getState().setUnit(latest.room.unit as any);
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

  return (
    <div className="panel space-y-3">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        Project
      </h3>

      <div>
        <label className="input-label">Name</label>
        <input
          type="text"
          className="input-field"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex-1"
        >
          {saving ? 'Saving...' : projectId ? 'Save' : 'Create'}
        </button>
        <button onClick={handleLoad} className="btn-secondary flex-1">
          Load
        </button>
      </div>

      {message && (
        <p
          className={`text-xs ${
            message.startsWith('Error') ? 'text-red-400' : 'text-green-400'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
