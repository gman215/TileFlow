const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export interface ProjectDTO {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  room: {
    width: number;
    height: number;
    unit: string;
  } | null;
  tileConfig: {
    width: number;
    height: number;
    grout: number;
    pattern: string;
    alpha: number;
    beta: number;
  } | null;
}

export const api = {
  listProjects: () => request<ProjectDTO[]>('/projects'),

  getProject: (id: string) => request<ProjectDTO>(`/projects/${id}`),

  createProject: (data: {
    name: string;
    room: { width: number; height: number; unit: string };
    tileConfig: {
      width: number;
      height: number;
      grout: number;
      pattern: string;
      alpha: number;
      beta: number;
    };
  }) =>
    request<ProjectDTO>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateProject: (
    id: string,
    data: Partial<{
      name: string;
      room: { width: number; height: number; unit: string };
      tileConfig: {
        width: number;
        height: number;
        grout: number;
        pattern: string;
        alpha: number;
        beta: number;
      };
    }>
  ) =>
    request<ProjectDTO>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),

  saveLayout: (
    projectId: string,
    data: { layoutData: unknown; configData: unknown; score: number; label?: string }
  ) =>
    request(`/projects/${projectId}/layouts`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
