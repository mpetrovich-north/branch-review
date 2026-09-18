import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchComments,
  fetchCommits,
  fetchDiff,
  fetchMeta,
  fetchRepos,
  fetchSuggestedBase,
  getActiveRepoPath,
  readStoredRepoPath,
  saveConfig,
  setActiveRepoPath,
} from './api'
import { CommitReview } from './CommitReview'
import { CommitIcon, MoonIcon, SunIcon } from './icons'
import { effectiveTheme, toggleStoredTheme, type ThemePreference } from './theme'
import type {
  BaseSuggestion,
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

function repoFromQuery(): string | null {
  const value = new URLSearchParams(window.location.search).get('repo')
  return value && value.trim() ? value.trim() : null
}

function pickInitialRepo(
  repos: RepoInfo[],
  preferredRepo: string | null,
): string | null {
  const url = parseViewUrl()
  if (url.repoName) {
    const byName = repos.find((r) => r.name === url.repoName)
    if (byName) return byName.path
    const byPath = repos.find((r) => r.path === url.repoName)
    if (byPath) return byPath.path
  }
  const candidates = [repoFromQuery(), readStoredRepoPath(), preferredRepo]
  for (const candidate of candidates) {
    if (candidate && repos.some((r) => r.path === candidate)) return candidate
  }
  return repos[0]?.path ?? preferredRepo ?? null
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
  const [suggestion, setSuggestion] = useState<BaseSuggestion | null>(null)
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
        setSuggestion(m.suggestedBase)
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
        setSuggestion(m.suggestedBase)
        await loadReviewData()
      } else {
        setReviewDraft(REVIEW_BRANCH_PLACEHOLDER)
        const suggested = m.suggestedBase?.baseBranch ?? m.defaultBaseBranch
        setBaseDraft(suggested)
        setSuggestion(m.suggestedBase)
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
        const initial = pickInitialRepo(listed.repos, listed.preferredRepo)
        if (!initial) {
          setError('No git repos found under the configured roots')
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
          setSuggestion(res.suggestedBase)
          if (savedReview === reviewDraft.trim()) return
          if (res.suggestedBase) {
            setBaseDraft(res.suggestedBase.baseBranch)
          }
        })
        .catch(() => {
          /* keep prior suggestion */
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

  const reviewOptions = useMemo(() => {
    const branches = meta?.branches ?? []
    if (!reviewDraft || reviewDraft === REVIEW_BRANCH_PLACEHOLDER) return branches
    return withBranch(branches, reviewDraft)
  }, [meta?.branches, reviewDraft])

  const baseOptions = useMemo(() => {
    let list = withBranch(meta?.branches ?? [], baseDraft)
    if (suggestion?.baseBranch) {
      list = [suggestion.baseBranch, ...list.filter((b) => b !== suggestion.baseBranch)]
    }
    if (meta?.defaultBaseBranch && meta.defaultBaseBranch !== suggestion?.baseBranch) {
      list = [
        ...(suggestion?.baseBranch ? [suggestion.baseBranch] : []),
        meta.defaultBaseBranch,
        ...list.filter(
          (b) => b !== suggestion?.baseBranch && b !== meta.defaultBaseBranch,
        ),
      ]
    }
    return list
  }, [meta?.branches, meta?.defaultBaseBranch, baseDraft, suggestion?.baseBranch])

  async function onRepoChange(next: string) {
    setLoading(true)
    try {
      await loadRepo(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch repo')
    } finally {
      setLoading(false)
    }
  }

  if (loading && !meta) {
    return (
      <div className="app-shell">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (!repoPath || (!meta && error)) {
    return (
      <div className="app-shell">
        <p className="error">{error ?? 'No repository selected.'}</p>
      </div>
    )
  }

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
          {reviewOptions.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
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
          {baseDraft && !baseOptions.includes(baseDraft) ? (
            <option value={baseDraft}>{baseDraft}</option>
          ) : null}
          {baseOptions.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
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
                <h1 className="commit-list-title">Branch Review</h1>
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
            {!meta ? (
              <p className="empty">Loading repository…</p>
            ) : !ready ? null : commits.length === 0 ? (
              <p className="empty">No commits ahead of the base branch.</p>
            ) : (
              <>
                <div className="commit-list-count">
                  {commits.length} {commits.length === 1 ? 'commit' : 'commits'}
                </div>
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
              </>
            )}
          </div>
        </aside>

        <main className="main-pane">
          {showSetupHint ? (
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
