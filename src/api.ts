import type {
  BaseSuggestion,
  CommentsFile,
  CommitSummary,
  DiffFile,
  MetaResponse,
  RepoInfo,
  ReviewConfig,
} from './types'

const REPO_STORAGE_KEY = 'commit-review.repoPath'

let activeRepoPath: string | null = null

export function getActiveRepoPath(): string | null {
  return activeRepoPath
}

export function setActiveRepoPath(repoPath: string | null): void {
  activeRepoPath = repoPath
  if (repoPath) {
    localStorage.setItem(REPO_STORAGE_KEY, repoPath)
  } else {
    localStorage.removeItem(REPO_STORAGE_KEY)
  }
}

export function readStoredRepoPath(): string | null {
  return localStorage.getItem(REPO_STORAGE_KEY)
}

function withRepo(url: string): string {
  if (!activeRepoPath) return url
  const join = url.includes('?') ? '&' : '?'
  return `${url}${join}repo=${encodeURIComponent(activeRepoPath)}`
}

async function request<T>(apiPath: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (activeRepoPath) {
    headers['X-Repo-Path'] = activeRepoPath
  }

  const res = await fetch(withRepo(apiPath), {
    ...init,
    headers,
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

export function fetchRepos() {
  return request<{
    roots: string[]
    preferredRepo: string | null
    repos: RepoInfo[]
  }>('/api/repos')
}

export function fetchMeta() {
  return request<MetaResponse>('/api/meta')
}

export function fetchSuggestedBase(reviewBranch: string) {
  return request<{
    reviewBranch: string
    suggestedBase: BaseSuggestion | null
  }>(`/api/suggest-base?reviewBranch=${encodeURIComponent(reviewBranch)}`)
}

export function saveConfig(config: ReviewConfig) {
  return request<{ config: ReviewConfig }>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  })
}

export function fetchCommits() {
  return request<{
    baseBranch: string
    reviewBranch: string
    commits: CommitSummary[]
  }>('/api/commits')
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
