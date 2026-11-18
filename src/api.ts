import type {
  BaseSuggestion,
  CommentsFile,
  CommitSummary,
  DiffFile,
  DiffStatCounts,
  MetaResponse,
  RepoInfo,
  ReviewConfig,
} from './types'

const REPO_STORAGE_KEY = 'branch-review.repoPath'
const REPO_ROOT_STORAGE_KEY = 'branch-review.repoRoot'

let activeRepoPath: string | null = null

function readStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(storage: Storage, key: string, value: string | null): void {
  try {
    if (value) storage.setItem(key, value)
    else storage.removeItem(key)
  } catch {
    /* ignore quota / private-mode failures */
  }
}

export function getActiveRepoPath(): string | null {
  return activeRepoPath
}

/** Per-tab only — never localStorage, which is shared across tabs. */
export function setActiveRepoPath(repoPath: string | null): void {
  activeRepoPath = repoPath
  writeStorage(sessionStorage, REPO_STORAGE_KEY, repoPath)
  // Drop the old shared key so a refresh cannot adopt another tab's repo.
  writeStorage(localStorage, REPO_STORAGE_KEY, null)
}

export function readStoredRepoPath(): string | null {
  return readStorage(sessionStorage, REPO_STORAGE_KEY)
}

/** Per-tab scan root — localStorage was shared and made other tabs adopt this tab's directory. */
export function readStoredRepoRoot(): string | null {
  return readStorage(sessionStorage, REPO_ROOT_STORAGE_KEY)
}

export function setStoredRepoRoot(root: string | null): void {
  writeStorage(sessionStorage, REPO_ROOT_STORAGE_KEY, root)
  writeStorage(localStorage, REPO_ROOT_STORAGE_KEY, null)
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

export type RepoListResponse = {
  roots: string[]
  fromCli: boolean
  repos: RepoInfo[]
  cancelled?: boolean
}

function repoPathFromBrowser(): string | null {
  try {
    const value = new URLSearchParams(window.location.search).get('repo')
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

/** Candidate scan roots so this tab can see `repoPath` again after another tab changed directory. */
function scanRootsForRepo(repoPath: string): string[] {
  const trimmed = repoPath.replace(/\/+$/, '')
  const parent = trimmed.split('/').slice(0, -1).join('/')
  const out: string[] = []
  if (parent) out.push(parent)
  out.push(trimmed)
  return out
}

async function restoreRepoRoot(root: string): Promise<RepoListResponse | null> {
  try {
    const restored = await request<RepoListResponse>('/api/repo-roots', {
      method: 'PUT',
      body: JSON.stringify({ roots: [root] }),
    })
    if (restored.roots[0]) setStoredRepoRoot(restored.roots[0])
    return restored
  } catch {
    return null
  }
}

export async function fetchRepos() {
  const listed = await request<RepoListResponse>('/api/repos')
  if (listed.fromCli) {
    if (listed.roots[0]) setStoredRepoRoot(listed.roots[0])
    return listed
  }

  const wantedRepo = repoPathFromBrowser() ?? readStoredRepoPath()
  const rootsToTry = [
    readStoredRepoRoot(),
    ...(wantedRepo ? scanRootsForRepo(wantedRepo) : []),
  ].filter((r, i, all): r is string => Boolean(r) && all.indexOf(r) === i)

  for (const root of rootsToTry) {
    const hasWanted =
      !wantedRepo || listed.repos.some((r) => r.path === wantedRepo)
    // Reuse the first GET when it already matches this tab; otherwise restore.
    if (root === listed.roots[0]) {
      if (hasWanted) {
        setStoredRepoRoot(root)
        return listed
      }
      continue
    }
    const restored = await restoreRepoRoot(root)
    if (!restored) continue
    if (!wantedRepo || restored.repos.some((r) => r.path === wantedRepo)) {
      return restored
    }
  }

  if (rootsToTry.length > 0) setStoredRepoRoot(null)
  return listed
}

export async function pickRepoRoot() {
  const listed = await request<RepoListResponse>('/api/repo-roots/pick', {
    method: 'POST',
  })
  if (!listed.cancelled && listed.roots[0]) {
    setStoredRepoRoot(listed.roots[0])
  }
  return listed
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
    stats: DiffStatCounts
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

export function updateComment(
  id: string,
  patch: { body?: string; resolved?: boolean },
) {
  return request<CommentsFile>(`/api/comments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function setCommentResolved(id: string, resolved: boolean) {
  return updateComment(id, { resolved })
}

export function removeComment(id: string) {
  return request<CommentsFile>(`/api/comments/${id}`, { method: 'DELETE' })
}

export function upsertMessageEdit(
  sha: string,
  patch: { subject?: string | null; body?: string | null },
) {
  return request<CommentsFile>(`/api/message-edits/${encodeURIComponent(sha)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export function setReviewed(sha: string, reviewed: boolean) {
  return request<CommentsFile>(`/api/reviewed/${encodeURIComponent(sha)}`, {
    method: 'PUT',
    body: JSON.stringify({ reviewed }),
  })
}
