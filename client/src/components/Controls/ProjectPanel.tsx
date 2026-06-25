import React from 'react';
import { useProjectActions } from '../../hooks/useProjectActions';

export default function ProjectPanel() {
  const {
    projectId,
    projectName,
    setProjectName,
    saving,
    message,
    handleSave,
    handleLoad,
  } = useProjectActions();

  return (
    <div className="px-4 py-4 space-y-3">
      <h3 className="section-header">Project</h3>

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
          {saving ? 'Saving…' : projectId ? 'Save' : 'Create'}
        </button>
        <button onClick={handleLoad} className="btn-secondary flex-1">
          Load
        </button>
      </div>

      {message && (
        <p
          className={`text-xs ${
            message.startsWith('Error') ? 'text-red-600' : 'text-green-600'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
