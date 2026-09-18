import type {
  CommentsFile,
  CommitSummary,
  DiffFile,
  MetaResponse,
  ReviewConfig,
} from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: string }).error)
        : `Request failed: ${res.status}`,
    )
  }
  return data as T
}

export function fetchMeta() {
  return request<MetaResponse>('/api/meta')
}

export function saveConfig(config: ReviewConfig) {
  return request<{ config: ReviewConfig }>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  })
}

export function fetchCommits() {
  return request<{ baseBranch: string; commits: CommitSummary[] }>('/api/commits')
}

export function fetchDiff(sha: string) {
  return request<{ sha: string; files: DiffFile[] }>(`/api/commits/${sha}/diff`)
}

export function fetchComments() {
  return request<CommentsFile>('/api/comments')
}

export function createComment(body: unknown) {
  return request<CommentsFile>('/api/comments', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function removeComment(id: string) {
  return request<CommentsFile>(`/api/comments/${id}`, { method: 'DELETE' })
}
