import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchComments,
  fetchCommits,
  fetchDiff,
  fetchMeta,
  fetchSuggestedBase,
  saveConfig,
} from './api'
import { CommitReview } from './CommitReview'
import type { BaseSuggestion, Comment, CommitSummary, DiffFile, MetaResponse } from './types'
import './App.css'

function configIsReady(config: MetaResponse['config']): boolean {
  return Boolean(config?.baseBranch && config.reviewBranch)
}

function withBranch(branches: string[], extra: string | null | undefined): string[] {
  if (!extra) return branches
  if (branches.includes(extra)) return branches
  return [extra, ...branches]
}

export default function App() {
  const [meta, setMeta] = useState<MetaResponse | null>(null)
  const [baseDraft, setBaseDraft] = useState('main')
  const [reviewDraft, setReviewDraft] = useState('')
  const [baseTouched, setBaseTouched] = useState(false)
  const [suggestion, setSuggestion] = useState<BaseSuggestion | null>(null)
  const [commits, setCommits] = useState<CommitSummary[]>([])
  const [selectedSha, setSelectedSha] = useState<string | null>(null)
  const [files, setFiles] = useState<DiffFile[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)

  const loadReviewData = useCallback(async () => {
    const [commitRes, commentRes] = await Promise.all([fetchCommits(), fetchComments()])
    setCommits(commitRes.commits)
    setComments(commentRes.comments)
    setSelectedSha((prev) => {
      if (prev && commitRes.commits.some((c) => c.sha === prev)) return prev
      return commitRes.commits[0]?.sha ?? null
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const m = await fetchMeta()
        if (cancelled) return
        setMeta(m)
        const review =
          m.config?.reviewBranch ?? m.defaultReviewBranch ?? m.checkedOutBranch ?? ''
        setReviewDraft(review)
        if (configIsReady(m.config)) {
          setBaseDraft(m.config!.baseBranch)
          setBaseTouched(true)
          setSuggestion(m.suggestedBase)
          await loadReviewData()
        } else {
          const suggested = m.suggestedBase?.baseBranch ?? m.defaultBaseBranch
          setBaseDraft(suggested)
          setBaseTouched(false)
          setSuggestion(m.suggestedBase)
        }
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
  }, [loadReviewData])

  useEffect(() => {
    if (!reviewDraft.trim()) return
    let cancelled = false
    const handle = window.setTimeout(() => {
      fetchSuggestedBase(reviewDraft.trim())
        .then((res) => {
          if (cancelled) return
          setSuggestion(res.suggestedBase)
          if (!baseTouched && res.suggestedBase) {
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
  }, [reviewDraft, baseTouched])

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
  }, [selectedSha])

  const reviewOptions = useMemo(
    () => withBranch(meta?.branches ?? [], reviewDraft),
    [meta?.branches, reviewDraft],
  )

  const baseOptions = useMemo(() => {
    let list = withBranch(meta?.branches ?? [], baseDraft)
    if (suggestion?.baseBranch) {
      list = [suggestion.baseBranch, ...list.filter((b) => b !== suggestion.baseBranch)]
    }
    if (meta?.defaultBaseBranch) {
      list = [
        meta.defaultBaseBranch,
        ...list.filter((b) => b !== meta.defaultBaseBranch && b !== suggestion?.baseBranch),
      ]
      if (suggestion?.baseBranch && suggestion.baseBranch !== meta.defaultBaseBranch) {
        list = [
          suggestion.baseBranch,
          meta.defaultBaseBranch,
          ...list.filter(
            (b) => b !== suggestion.baseBranch && b !== meta.defaultBaseBranch,
          ),
        ]
      }
    }
    return list
  }, [meta?.branches, meta?.defaultBaseBranch, baseDraft, suggestion?.baseBranch])

  async function onSaveConfig() {
    setSavingConfig(true)
    setError(null)
    try {
      const { config } = await saveConfig({
        baseBranch: baseDraft.trim(),
        reviewBranch: reviewDraft.trim(),
      })
      setMeta((m) => (m ? { ...m, config } : m))
      setBaseTouched(true)
      await loadReviewData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save config')
    } finally {
      setSavingConfig(false)
    }
  }

  function applySuggestion() {
    if (!suggestion) return
    setBaseDraft(suggestion.baseBranch)
    setBaseTouched(false)
  }

  if (loading) {
    return (
      <div className="app-shell">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="app-shell">
        <p className="error">{error ?? 'Could not reach the review server.'}</p>
      </div>
    )
  }

  const needsSetup = !configIsReady(meta.config)
  const selected = commits.find((c) => c.sha === selectedSha) ?? null
  const selectedIndex = selected ? commits.findIndex((c) => c.sha === selected.sha) : -1
  const reviewBranch = meta.config?.reviewBranch
  const checkedOutNote =
    meta.checkedOutBranch == null
      ? 'checked out: detached'
      : meta.checkedOutBranch === reviewBranch
        ? `checked out: ${meta.checkedOutBranch}`
        : `checked out: ${meta.checkedOutBranch} (unchanged)`

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Commit review</h1>
          <p className="meta">
            <span title={meta.repoPath}>{meta.repoPath}</span>
            <span className="sep">·</span>
            <span>{checkedOutNote}</span>
          </p>
        </div>
        <div className="branch-controls">
          <div className="field">
            <label htmlFor="review-branch">Review branch</label>
            <select
              id="review-branch"
              value={reviewDraft}
              onChange={(e) => {
                setReviewDraft(e.target.value)
                setBaseTouched(false)
              }}
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
              onChange={(e) => {
                setBaseDraft(e.target.value)
                setBaseTouched(true)
              }}
            >
              {baseDraft && !baseOptions.includes(baseDraft) ? (
                <option value={baseDraft}>{baseDraft}</option>
              ) : null}
              {baseOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                  {suggestion?.baseBranch === b ? ' (suggested)' : ''}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" disabled={savingConfig} onClick={onSaveConfig}>
            {configIsReady(meta.config) ? 'Update' : 'Start review'}
          </button>
        </div>
      </header>

      {suggestion ? (
        <p className="suggest-banner">
          Suggested base for <code>{reviewDraft}</code>: <code>{suggestion.baseBranch}</code>
          <span className="sep">·</span>
          {suggestion.detail}
          {baseDraft !== suggestion.baseBranch ? (
            <>
              <span className="sep">·</span>
              <button type="button" className="btn link" onClick={applySuggestion}>
                Use suggestion
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {error ? <p className="error banner">{error}</p> : null}

      {needsSetup ? (
        <section className="setup">
          <h2>Choose branches</h2>
          <p>
            Pick the review branch (commits to inspect) and the base branch. For stacked work, the
            base is inferred when possible (parent branch tip that is an ancestor of the review
            branch). The app reads those refs only; it does not check out or change the branch on
            disk. Saved to <code>.review/config.json</code>.
          </p>
        </section>
      ) : (
        <div className="main-layout">
          <aside className="commit-list">
            <div className="commit-list-header">
              <h2>Commits</h2>
              <span className="muted">
                {commits.length} on {reviewBranch} vs {meta.config?.baseBranch}
              </span>
            </div>
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
