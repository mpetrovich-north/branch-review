import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchComments,
  fetchCommits,
  fetchDiff,
  fetchMeta,
  fetchRepos,
  fetchSuggestedBase,
  getActiveRepoPath,
  pickRepoRoot,
  readStoredRepoPath,
  saveConfig,
  setActiveRepoPath,
} from './api'
import { CommitReview } from './CommitReview'
import { CommitIcon, MoonIcon, SunIcon } from './icons'
import { effectiveTheme, toggleStoredTheme, type ThemePreference } from './theme'
import type {
  Comment,
  CommitSummary,
  DiffFile,
  MessageEdit,
  MetaResponse,
  RepoInfo,
} from './types'
import { parseViewUrl, replaceViewUrl } from './viewUrl'
import './App.css'

const REVIEW_BRANCH_PLACEHOLDER = ''
const CHANGE_DIRECTORY_VALUE = '__change_directory__'

function configIsReady(
  config: MetaResponse['config'],
): config is MetaResponse['config'] & { baseBranch: string; reviewBranch: string } {
  return Boolean(config?.baseBranch && config.reviewBranch)
}

function withBranch(branches: string[], extra: string | null | undefined): string[] {
  if (!extra) return branches
  if (branches.includes(extra)) return branches
  return [extra, ...branches]
}

function partitionBranchOptions(
  lists: { local: string[]; remote: string[] } | undefined,
  extra: string | null | undefined,
): { local: string[]; remote: string[] } {
  const local = [...(lists?.local ?? [])]
  const remote = (lists?.remote ?? []).filter((b) => !local.includes(b))
  if (!extra) return { local, remote }
  if (local.includes(extra) || remote.includes(extra)) return { local, remote }
  return { local: withBranch(local, extra), remote }
}

function BranchOptionGroups({
  local,
  remote,
}: {
  local: string[]
  remote: string[]
}) {
  return (
    <>
      {local.length > 0 ? (
        <optgroup label="Local">
          {local.map((b) => (
            <option key={`local:${b}`} value={b}>
              {b}
            </option>
          ))}
        </optgroup>
      ) : null}
      {remote.length > 0 ? (
        <optgroup label="Remote">
          {remote.map((b) => (
            <option key={`remote:${b}`} value={b}>
              {b}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  )
}

function repoFromQuery(): string | null {
  const value = new URLSearchParams(window.location.search).get('repo')
  return value && value.trim() ? value.trim() : null
}

function pickInitialRepo(repos: RepoInfo[]): string | null {
  const url = parseViewUrl()
  if (url.repoName) {
    const byName = repos.find((r) => r.name === url.repoName)
    if (byName) return byName.path
    const byPath = repos.find((r) => r.path === url.repoName)
    if (byPath) return byPath.path
  }
  const candidates = [repoFromQuery(), readStoredRepoPath()]
  for (const candidate of candidates) {
    if (candidate && repos.some((r) => r.path === candidate)) return candidate
  }
  return repos[0]?.path ?? null
}

function matchCommitSha(
  commits: CommitSummary[],
  want: string | null | undefined,
): string | null {
  if (!want) return null
  const exact = commits.find((c) => c.sha === want)
  if (exact) return exact.sha
  const prefix = commits.find(
    (c) => c.sha.startsWith(want) || want.startsWith(c.sha) || c.shortSha === want,
  )
  return prefix?.sha ?? null
}

const COMMITS_COLLAPSED_KEY = 'branch-review.commitsCollapsed'

function readStoredCommitsCollapsed(): boolean {
  try {
    return localStorage.getItem(COMMITS_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeStoredCommitsCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COMMITS_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [repos, setRepos] = useState<RepoInfo[]>([])
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [meta, setMeta] = useState<MetaResponse | null>(null)
  const [baseDraft, setBaseDraft] = useState('main')
  const [reviewDraft, setReviewDraft] = useState('')
  const [commits, setCommits] = useState<CommitSummary[]>([])
  const [selectedSha, setSelectedSha] = useState<string | null>(null)
  const [files, setFiles] = useState<DiffFile[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [messageEdits, setMessageEdits] = useState<Record<string, MessageEdit>>({})
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const [commitsCollapsed, setCommitsCollapsedState] = useState(readStoredCommitsCollapsed)
  const [theme, setTheme] = useState<ThemePreference>(() => effectiveTheme())
  const [activeFilePath, setActiveFilePath] = useState<string | null>(
    () => parseViewUrl().filePath,
  )
  const [seedFilePath, setSeedFilePath] = useState<string | null>(
    () => parseViewUrl().filePath,
  )
  const hydrated = useRef(false)
  const configSaveGen = useRef(0)
  const preferShaRef = useRef<string | null>(parseViewUrl().commitSha)

  function setCommitsCollapsed(collapsed: boolean) {
    setCommitsCollapsedState(collapsed)
    writeStoredCommitsCollapsed(collapsed)
  }

  const loadReviewData = useCallback(async () => {
    const [commitRes, commentRes] = await Promise.all([fetchCommits(), fetchComments()])
    setCommits(commitRes.commits)
    setComments(commentRes.comments)
    setMessageEdits(commentRes.messageEdits ?? {})
    setSelectedSha((prev) => {
      const fromUrl = matchCommitSha(commitRes.commits, preferShaRef.current)
      if (fromUrl) {
        preferShaRef.current = null
        return fromUrl
      }
      if (prev && commitRes.commits.some((c) => c.sha === prev)) return prev
      return commitRes.commits[0]?.sha ?? null
    })
  }, [])

  const loadRepo = useCallback(
    async (nextRepo: string) => {
      setActiveRepoPath(nextRepo)
      setRepoPath(nextRepo)
      hydrated.current = false
      setError(null)
      setCommits([])
      setFiles([])
      setComments([])
      setMessageEdits({})
      setSelectedSha(null)
      const m = await fetchMeta()
      setMeta(m)
      const url = parseViewUrl()
      if (url.reviewBranch && url.baseBranch) {
        setReviewDraft(url.reviewBranch)
        setBaseDraft(url.baseBranch)
        preferShaRef.current = url.commitSha
        setSeedFilePath(url.filePath)
        setActiveFilePath(url.filePath)
        if (
          m.config?.reviewBranch === url.reviewBranch &&
          m.config?.baseBranch === url.baseBranch
        ) {
          await loadReviewData()
        }
      } else if (configIsReady(m.config)) {
        setReviewDraft(m.config.reviewBranch)
        setBaseDraft(m.config.baseBranch)
        await loadReviewData()
      } else {
        setReviewDraft(REVIEW_BRANCH_PLACEHOLDER)
        const suggested = m.suggestedBase?.baseBranch ?? m.defaultBaseBranch
        setBaseDraft(suggested)
      }
      hydrated.current = true
    },
    [loadReviewData],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const listed = await fetchRepos()
        if (cancelled) return
        setRepos(listed.repos)
        const initial = pickInitialRepo(listed.repos)
        if (!initial) {
          setActiveRepoPath(null)
          setRepoPath(null)
          setMeta(null)
          return
        }
        await loadRepo(initial)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadRepo])

  useEffect(() => {
    if (!hydrated.current || !reviewDraft.trim() || !getActiveRepoPath()) return
    let cancelled = false
    const handle = window.setTimeout(() => {
      const savedReview = meta?.config?.reviewBranch
      fetchSuggestedBase(reviewDraft.trim())
        .then((res) => {
          if (cancelled) return
          if (savedReview === reviewDraft.trim()) return
          if (res.suggestedBase) {
            setBaseDraft(res.suggestedBase.baseBranch)
          }
        })
        .catch(() => {
          /* keep prior base */
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [reviewDraft, meta?.config?.reviewBranch, repoPath])

  useEffect(() => {
    if (!hydrated.current || !meta || !getActiveRepoPath()) return
    const reviewBranch = reviewDraft.trim()
    const baseBranch = baseDraft.trim()
    if (!reviewBranch || !baseBranch || reviewBranch === baseBranch) {
      setSavingConfig(false)
      return
    }
    if (meta.config?.reviewBranch === reviewBranch && meta.config?.baseBranch === baseBranch) {
      setSavingConfig(false)
      return
    }

    const gen = ++configSaveGen.current
    let cancelled = false
    const handle = window.setTimeout(() => {
      setSavingConfig(true)
      setError(null)
      saveConfig({ baseBranch, reviewBranch })
        .then(async ({ config }) => {
          if (cancelled || configSaveGen.current !== gen) return
          setMeta((m) => (m ? { ...m, config } : m))
          await loadReviewData()
        })
        .catch((e) => {
          if (!cancelled && configSaveGen.current === gen) {
            setError(e instanceof Error ? e.message : 'Failed to save config')
          }
        })
        .finally(() => {
          if (configSaveGen.current === gen) setSavingConfig(false)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [reviewDraft, baseDraft, meta, loadReviewData, repoPath])

  useEffect(() => {
    const repo = repos.find((r) => r.path === repoPath)?.name
    const branch = reviewDraft.trim()
    if (repo && branch) {
      document.title = `Branch Review: ${repo}/${branch}`
    } else if (repo) {
      document.title = `Branch Review: ${repo}`
    } else {
      document.title = 'Branch Review'
    }
  }, [repos, repoPath, reviewDraft])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setTheme(effectiveTheme())
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const onPopState = () => {
      const url = parseViewUrl()
      preferShaRef.current = url.commitSha
      setSeedFilePath(url.filePath)
      setActiveFilePath(url.filePath)

      if (url.repoName && repos.length > 0) {
        const match =
          repos.find((r) => r.name === url.repoName) ??
          repos.find((r) => r.path === url.repoName)
        if (match && match.path !== repoPath) {
          void loadRepo(match.path).catch((e) => {
            setError(e instanceof Error ? e.message : 'Failed to switch repo')
          })
          return
        }
      }
      if (url.reviewBranch) setReviewDraft(url.reviewBranch)
      if (url.baseBranch) setBaseDraft(url.baseBranch)
      if (url.commitSha && commits.length > 0) {
        const sha = matchCommitSha(commits, url.commitSha)
        if (sha) setSelectedSha(sha)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [repos, repoPath, commits, loadRepo])

  useEffect(() => {
    if (!hydrated.current || !repoPath) return
    const repo = repos.find((r) => r.path === repoPath)
    if (!repo) return
    const review = reviewDraft.trim()
    const base = baseDraft.trim()
    replaceViewUrl({
      repoName: repo.name,
      reviewBranch: review || null,
      baseBranch: base || null,
      commitSha: selectedSha,
      filePath: activeFilePath,
    })
  }, [
    repoPath,
    repos,
    reviewDraft,
    baseDraft,
    selectedSha,
    activeFilePath,
  ])

  const needsReviewPick = Boolean(meta && !configIsReady(meta.config))
  const showSetupHint = needsReviewPick && !commitsCollapsed

  useEffect(() => {
    if (!selectedSha) {
      setFiles([])
      return
    }
    let cancelled = false
    setDiffLoading(true)
    fetchDiff(selectedSha)
      .then((res) => {
        if (!cancelled) setFiles(res.files)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load diff')
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedSha, repoPath])

  const reviewOptions = useMemo(
    () =>
      partitionBranchOptions(
        meta?.branches,
        reviewDraft && reviewDraft !== REVIEW_BRANCH_PLACEHOLDER ? reviewDraft : null,
      ),
    [meta?.branches, reviewDraft],
  )

  const baseOptions = useMemo(
    () => partitionBranchOptions(meta?.branches, baseDraft),
    [meta?.branches, baseDraft],
  )

  async function onRepoChange(next: string) {
    if (next === CHANGE_DIRECTORY_VALUE) {
      await changeScanDirectory()
      return
    }
    setLoading(true)
    try {
      await loadRepo(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch repo')
    } finally {
      setLoading(false)
    }
  }

  async function changeScanDirectory() {
    setLoading(true)
    setError(null)
    configSaveGen.current += 1
    try {
      const listed = await pickRepoRoot()
      if (listed.cancelled) return
      setRepos(listed.repos)
      const next = pickInitialRepo(listed.repos)
      if (!next) {
        setActiveRepoPath(null)
        setRepoPath(null)
        setMeta(null)
        setCommits([])
        setFiles([])
        setComments([])
        setMessageEdits({})
        setSelectedSha(null)
        setReviewDraft('')
        setBaseDraft('')
        hydrated.current = false
        return
      }
      await loadRepo(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change directory')
    } finally {
      setLoading(false)
    }
  }

  if (loading && !meta && repos.length === 0) {
    return (
      <div className="app-shell">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  const noRepos = repos.length === 0
  const ready = configIsReady(meta?.config ?? null)
  const selected = commits.find((c) => c.sha === selectedSha) ?? null
  const selectedIndex = selected ? commits.findIndex((c) => c.sha === selected.sha) : -1

  const branchControls = (
    <div className="branch-controls">
      <div className="field">
        <label htmlFor="repo-path">Repo</label>
        <select
          id="repo-path"
          value={repoPath ?? ''}
          onChange={(e) => {
            void onRepoChange(e.target.value)
          }}
        >
          {noRepos ? (
            <option value="" disabled>
              No repos
            </option>
          ) : null}
          <option value={CHANGE_DIRECTORY_VALUE}>Change directory…</option>
          {repos.map((r) => (
            <option key={r.path} value={r.path} title={r.path}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="review-branch">Review branch</label>
        <select
          id="review-branch"
          value={reviewDraft}
          onChange={(e) => setReviewDraft(e.target.value)}
          disabled={!meta}
        >
          {reviewDraft === REVIEW_BRANCH_PLACEHOLDER ? (
            <option value={REVIEW_BRANCH_PLACEHOLDER} disabled>
              Select branch
            </option>
          ) : null}
          <BranchOptionGroups local={reviewOptions.local} remote={reviewOptions.remote} />
        </select>
      </div>
      <div className="field">
        <label htmlFor="base-branch">Compare to</label>
        <select
          id="base-branch"
          value={baseDraft}
          onChange={(e) => setBaseDraft(e.target.value)}
          disabled={!meta}
        >
          <BranchOptionGroups local={baseOptions.local} remote={baseOptions.remote} />
        </select>
      </div>
      {savingConfig ? <span className="muted updating-label">Updating…</span> : null}
    </div>
  )

  return (
    <div className="app-shell">
      {error ? <p className="error banner">{error}</p> : null}

      <div className={`main-layout${commitsCollapsed ? ' commits-collapsed' : ''}`}>
        <aside className={`commit-list${commitsCollapsed ? ' is-collapsed' : ''}`}>
          <div className="commit-list-header">
            {commitsCollapsed ? (
              <button
                type="button"
                className="commit-list-toggle"
                aria-expanded={false}
                aria-controls="commit-list-body"
                title="Show commits"
                onClick={() => setCommitsCollapsed(false)}
              >
                <svg
                  className="commit-list-toggle-icon"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <path
                    d="M6.5 3.25 11 8l-4.5 4.75"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="visually-hidden">Show commits</span>
              </button>
            ) : (
              <>
                <div className="commit-list-heading">
                  <h1 className="commit-list-title">Branch Review</h1>
                  <a
                    className="commit-list-help"
                    href="https://github.com/mpetrovich-north/branch-review"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Project on GitHub"
                  >
                    <svg
                      className="commit-list-help-icon"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                    >
                      <circle
                        cx="8"
                        cy="8"
                        r="6.25"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.25"
                      />
                      <path
                        d="M6.35 6.2c0-.95.7-1.55 1.65-1.55.95 0 1.65.55 1.65 1.4 0 .7-.4 1.1-.95 1.4-.55.3-.85.55-.85 1.15v.25"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.25"
                        strokeLinecap="round"
                      />
                      <circle cx="8" cy="11.35" r="0.7" fill="currentColor" />
                    </svg>
                    <span className="visually-hidden">Project on GitHub</span>
                  </a>
                </div>
                <button
                  type="button"
                  className="commit-list-toggle"
                  aria-expanded={true}
                  aria-controls="commit-list-body"
                  title="Hide commits"
                  onClick={() => setCommitsCollapsed(true)}
                >
                  <svg
                    className="commit-list-toggle-icon"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                  >
                    <path
                      d="M9.5 3.25 5 8l4.5 4.75"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="visually-hidden">Hide commits</span>
                </button>
              </>
            )}
          </div>

          {!commitsCollapsed ? branchControls : null}

          <div id="commit-list-body" className="commit-list-body" hidden={commitsCollapsed}>
            {noRepos ? null : !meta ? (
              <p className="empty">Loading repository…</p>
            ) : !ready ? null : commits.length === 0 ? (
              <p className="empty">No commits ahead of the base branch.</p>
            ) : (
              <>
                <div className="commit-list-count">
                  {commits.length} {commits.length === 1 ? 'commit' : 'commits'}
                </div>
                <div className="commit-list-scroll">
                  <ol>
                    {commits.map((c, i) => (
                      <li key={c.sha}>
                        <button
                          type="button"
                          className={c.sha === selectedSha ? 'active' : ''}
                          onClick={() => {
                            setSeedFilePath(null)
                            setSelectedSha(c.sha)
                          }}
                        >
                          <span className="idx">{i + 1}</span>
                          <span className="subject">
                            {messageEdits[c.sha]?.subject ?? c.subject}
                          </span>
                          <span className="sha-with-icon">
                            <CommitIcon className="commit-hash-icon" />
                            <code className="sha">{c.shortSha}</code>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              </>
            )}
          </div>
        </aside>

        <main className="main-pane">
          {noRepos ? (
            <p className="empty">No repos found in that directory.</p>
          ) : showSetupHint ? (
            <div className="setup-hint">
              <svg
                className="setup-hint-arrow"
                width="36"
                height="16"
                viewBox="0 0 36 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  d="M34 8H6M10 3.5 4 8l6 4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <p className="setup-hint-text">Select a review branch to begin</p>
            </div>
          ) : !meta || !ready ? (
            <p className="muted setup-wait">
              {meta ? 'Select a review branch to begin' : 'Loading repository…'}
            </p>
          ) : selected ? (
            diffLoading ? (
              <p className="muted">Loading diff…</p>
            ) : (
              <CommitReview
                commit={selected}
                files={files}
                comments={comments}
                messageEdit={messageEdits[selected.sha]}
                onReviewFileChange={(file) => {
                  setComments(file.comments)
                  setMessageEdits(file.messageEdits ?? {})
                }}
                initialFilePath={seedFilePath}
                onFilePathChange={setActiveFilePath}
                nav={{
                  index: selectedIndex,
                  total: commits.length,
                  onPrev: () => {
                    setSeedFilePath(null)
                    setSelectedSha(commits[selectedIndex - 1]!.sha)
                  },
                  onNext: () => {
                    setSeedFilePath(null)
                    setSelectedSha(commits[selectedIndex + 1]!.sha)
                  },
                }}
              />
            )
          ) : (
            <p className="empty">Select a commit to review.</p>
          )}
        </main>
      </div>

      <button
        type="button"
        className="theme-toggle"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        onClick={() => setTheme(toggleStoredTheme())}
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>
    </div>
  )
}
