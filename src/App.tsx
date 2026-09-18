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
import type {
  BaseSuggestion,
  Comment,
  CommitSummary,
  DiffFile,
  MetaResponse,
  RepoInfo,
} from './types'
import './App.css'

function configIsReady(config: MetaResponse['config']): boolean {
  return Boolean(config?.baseBranch && config.reviewBranch)
}

function withBranch(branches: string[], extra: string | null | undefined): string[] {
  if (!extra) return branches
  if (branches.includes(extra)) return branches
  return [extra, ...branches]
}

function repoFromUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get('repo')
  return value && value.trim() ? value.trim() : null
}

function pickInitialRepo(
  repos: RepoInfo[],
  preferredRepo: string | null,
): string | null {
  const candidates = [repoFromUrl(), readStoredRepoPath(), preferredRepo]
  for (const candidate of candidates) {
    if (candidate && repos.some((r) => r.path === candidate)) return candidate
  }
  return repos[0]?.path ?? preferredRepo ?? null
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
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const hydrated = useRef(false)

  const loadReviewData = useCallback(async () => {
    const [commitRes, commentRes] = await Promise.all([fetchCommits(), fetchComments()])
    setCommits(commitRes.commits)
    setComments(commentRes.comments)
    setSelectedSha((prev) => {
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
      setSelectedSha(null)
      const m = await fetchMeta()
      setMeta(m)
      const review =
        m.config?.reviewBranch ?? m.defaultReviewBranch ?? m.checkedOutBranch ?? ''
      setReviewDraft(review)
      if (configIsReady(m.config)) {
        setBaseDraft(m.config!.baseBranch)
        setSuggestion(m.suggestedBase)
        await loadReviewData()
      } else {
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
    if (!reviewBranch || !baseBranch || reviewBranch === baseBranch) return
    if (meta.config?.reviewBranch === reviewBranch && meta.config?.baseBranch === baseBranch) {
      return
    }

    let cancelled = false
    const handle = window.setTimeout(() => {
      setSavingConfig(true)
      setError(null)
      saveConfig({ baseBranch, reviewBranch })
        .then(async ({ config }) => {
          if (cancelled) return
          setMeta((m) => (m ? { ...m, config } : m))
          await loadReviewData()
        })
        .catch((e) => {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : 'Failed to save config')
          }
        })
        .finally(() => {
          if (!cancelled) setSavingConfig(false)
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [reviewDraft, baseDraft, meta, loadReviewData, repoPath])

  useEffect(() => {
    if (loading) return
    const el = document.querySelector('.topbar')
    if (!(el instanceof HTMLElement)) return
    const apply = () => {
      document.documentElement.style.setProperty(
        '--topbar-offset',
        `${el.getBoundingClientRect().height}px`,
      )
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading, meta, savingConfig, error, repoPath])

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
    () => withBranch(meta?.branches ?? [], reviewDraft),
    [meta?.branches, reviewDraft],
  )

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
  const reviewBranch = meta?.config?.reviewBranch

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Commit review</h1>
          <p className="meta">
            {savingConfig ? <span>Updating…</span> : <span title={repoPath}>{repoPath}</span>}
          </p>
        </div>
        <div className="branch-controls">
          <div className="field">
            <label htmlFor="repo-path">Repo</label>
            <select
              id="repo-path"
              value={repoPath}
              onChange={(e) => {
                void onRepoChange(e.target.value)
              }}
            >
              {repos.map((r) => (
                <option key={r.path} value={r.path}>
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
              {reviewDraft && !reviewOptions.includes(reviewDraft) ? (
                <option value={reviewDraft}>{reviewDraft}</option>
              ) : null}
              {reviewOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="base-branch">Base branch</label>
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
        </div>
      </header>

      {error ? <p className="error banner">{error}</p> : null}

      {!meta || !ready ? (
        <p className="muted setup-wait">
          {meta ? 'Choose review and base branches to start.' : 'Loading repository…'}
        </p>
      ) : (
        <div className="main-layout">
          <aside className="commit-list">
            <div className="commit-list-header">
              <h2>
                {commits.length} {commits.length === 1 ? 'commit' : 'commits'}
              </h2>
              <p className="commit-list-range muted">
                {reviewBranch}
                <span className="sep">vs</span>
                {meta.config?.baseBranch}
              </p>
            </div>
            <div className="commit-list-body">
              {commits.length === 0 ? (
                <p className="empty">No commits ahead of the base branch.</p>
              ) : (
                <ol>
                  {commits.map((c, i) => (
                    <li key={c.sha}>
                      <button
                        type="button"
                        className={c.sha === selectedSha ? 'active' : ''}
                        onClick={() => setSelectedSha(c.sha)}
                      >
                        <span className="idx">{i + 1}</span>
                        <span className="subject">{c.subject}</span>
                        <code className="sha">{c.shortSha}</code>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </aside>

          <main className="main-pane">
            {selected ? (
              <>
                <div className="commit-nav">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={selectedIndex <= 0}
                    onClick={() => setSelectedSha(commits[selectedIndex - 1]!.sha)}
                  >
                    Previous
                  </button>
                  <span className="muted">
                    {selectedIndex + 1} / {commits.length}
                  </span>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={selectedIndex < 0 || selectedIndex >= commits.length - 1}
                    onClick={() => setSelectedSha(commits[selectedIndex + 1]!.sha)}
                  >
                    Next
                  </button>
                </div>
                {diffLoading ? (
                  <p className="muted">Loading diff…</p>
                ) : (
                  <CommitReview
                    commit={selected}
                    files={files}
                    comments={comments}
                    onCommentsChange={setComments}
                  />
                )}
              </>
            ) : (
              <p className="empty">Select a commit to review.</p>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
