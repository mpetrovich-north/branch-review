import { useCallback, useEffect, useState } from 'react'
import { fetchComments, fetchCommits, fetchDiff, fetchMeta, saveConfig } from './api'
import { CommitReview } from './CommitReview'
import type { Comment, CommitSummary, DiffFile, MetaResponse } from './types'
import './App.css'

export default function App() {
  const [meta, setMeta] = useState<MetaResponse | null>(null)
  const [baseDraft, setBaseDraft] = useState('main')
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
        setBaseDraft(m.config?.baseBranch ?? m.defaultBaseBranch)
        if (m.config) {
          await loadReviewData()
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

  async function onSaveBase() {
    setSavingConfig(true)
    setError(null)
    try {
      const { config } = await saveConfig({ baseBranch: baseDraft.trim() })
      setMeta((m) => (m ? { ...m, config } : m))
      await loadReviewData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save config')
    } finally {
      setSavingConfig(false)
    }
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

  const needsSetup = !meta.config
  const selected = commits.find((c) => c.sha === selectedSha) ?? null
  const selectedIndex = selected ? commits.findIndex((c) => c.sha === selected.sha) : -1

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Commit review</h1>
          <p className="meta">
            <span title={meta.repoPath}>{meta.repoPath}</span>
            <span className="sep">·</span>
            <code>{meta.branch}</code>
          </p>
        </div>
        <div className="base-control">
          <label htmlFor="base-branch">Base branch</label>
          <input
            id="base-branch"
            list="branch-options"
            value={baseDraft}
            onChange={(e) => setBaseDraft(e.target.value)}
          />
          <datalist id="branch-options">
            {meta.branches.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          <button type="button" className="btn" disabled={savingConfig} onClick={onSaveBase}>
            {meta.config ? 'Update' : 'Start review'}
          </button>
        </div>
      </header>

      {error ? <p className="error banner">{error}</p> : null}

      {needsSetup ? (
        <section className="setup">
          <h2>Choose a base branch</h2>
          <p>
            Review commits on <code>{meta.branch}</code> that are not on the base branch. Default is{' '}
            <code>main</code>. This is saved to <code>.review/config.json</code>.
          </p>
        </section>
      ) : (
        <div className="main-layout">
          <aside className="commit-list">
            <div className="commit-list-header">
              <h2>Commits</h2>
              <span className="muted">
                {commits.length} vs {meta.config?.baseBranch}
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
