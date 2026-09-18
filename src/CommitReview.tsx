import { useEffect, useMemo, useState } from 'react'
import type { Comment, CommitSummary, DiffFile, LineComment, LineType } from './types'
import { createComment, removeComment } from './api'

type Props = {
  commit: CommitSummary
  files: DiffFile[]
  comments: Comment[]
  onCommentsChange: (comments: Comment[]) => void
  nav: {
    index: number
    total: number
    onPrev: () => void
    onNext: () => void
  }
}

function lineNumberFor(line: DiffFile['lines'][number]): number | null {
  if (line.type === 'removed') return line.oldLine
  if (line.type === 'added' || line.type === 'unchanged') return line.newLine
  return null
}

function matchesLineComment(
  comment: LineComment,
  filePath: string,
  line: DiffFile['lines'][number],
): boolean {
  if (comment.path !== filePath) return false
  if (comment.lineType !== line.type) return false
  const n = lineNumberFor(line)
  return n !== null && n === comment.line
}

function formatCommitTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
}

function CommentBubbleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2.5 2.75h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7.2L4 14.25v-2.999H2.5a1 1 0 0 1-1-1v-6.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CommitReview({
  commit,
  files,
  comments,
  onCommentsChange,
  nav,
}: Props) {
  const [activePath, setActivePath] = useState(files[0]?.path ?? '')
  const [draftLine, setDraftLine] = useState<{
    path: string
    line: number
    lineType: LineType
    snippet: string
  } | null>(null)
  const [draftMessage, setDraftMessage] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function selectFile(path: string) {
    setActivePath(path)
    setDraftLine(null)
    setDraftMessage(false)
    setBody('')
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  useEffect(() => {
    setActivePath(files[0]?.path ?? '')
    setDraftLine(null)
    setDraftMessage(false)
    setBody('')
  }, [commit.sha, files])

  const activeFile = useMemo(
    () => files.find((f) => f.path === activePath) ?? files[0],
    [files, activePath],
  )

  const commitMessageComments = comments.filter(
    (c) => c.kind === 'commit_message' && c.commitSha === commit.sha,
  )
  const lineComments = comments.filter(
    (c): c is LineComment => c.kind === 'line' && c.commitSha === commit.sha,
  )

  async function submitLine() {
    if (!draftLine || !body.trim()) return
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        kind: 'line',
        commitSha: commit.sha,
        path: draftLine.path,
        line: draftLine.line,
        lineType: draftLine.lineType,
        body: body.trim(),
      }
      if (draftLine.snippet.trim() !== '') {
        payload.snippet = draftLine.snippet
      }
      const file = await createComment(payload)
      onCommentsChange(file.comments)
      setBody('')
      setDraftLine(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save comment')
    } finally {
      setBusy(false)
    }
  }

  async function submitCommitMessage() {
    if (!body.trim()) return
    setBusy(true)
    setError(null)
    try {
      const file = await createComment({
        kind: 'commit_message',
        commitSha: commit.sha,
        body: body.trim(),
      })
      onCommentsChange(file.comments)
      setBody('')
      setDraftMessage(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save comment')
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: string) {
    setBusy(true)
    setError(null)
    try {
      const file = await removeComment(id)
      onCommentsChange(file.comments)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete comment')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="commit-review">
      <section className="commit-message-panel">
        <div className="commit-message-header">
          <div className="commit-title-block">
            <h2>{commit.subject}</h2>
            <p className="meta">
              <code className="sha">{commit.shortSha}</code>
              <span className="sep">·</span>
              {commit.authorName}
              <span className="sep">·</span>
              {formatCommitTime(commit.authoredAt)}
            </p>
          </div>
          <div className="commit-nav">
            <button
              type="button"
              className="btn ghost"
              disabled={nav.index <= 0}
              onClick={nav.onPrev}
            >
              Previous
            </button>
            <span className="muted">
              {nav.index + 1} / {nav.total}
            </span>
            <button
              type="button"
              className="btn ghost"
              disabled={nav.index < 0 || nav.index >= nav.total - 1}
              onClick={nav.onNext}
            >
              Next
            </button>
          </div>
        </div>

        <div className="commit-message-row">
          <button
            type="button"
            className="comment-bubble"
            title="Comment on commit message"
            aria-label="Comment on commit message"
            onClick={() => {
              setDraftMessage(true)
              setDraftLine(null)
              setBody('')
            }}
          >
            <CommentBubbleIcon />
          </button>
          <div className="commit-message-content">
            {commit.body ? (
              <pre className="commit-body">{commit.body}</pre>
            ) : (
              <p className="muted commit-body-empty">No message body</p>
            )}
            {commitMessageComments.map((c) => (
              <div key={c.id} className="comment-thread">
                <p>{c.body}</p>
                <button
                  type="button"
                  className="btn link"
                  disabled={busy}
                  onClick={() => onDelete(c.id)}
                >
                  Delete
                </button>
              </div>
            ))}
            {draftMessage ? (
              <div className="comment-draft">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Comment on this commit message"
                  rows={3}
                  autoFocus
                />
                <div className="draft-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={submitCommitMessage}
                  >
                    Save comment
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      setDraftMessage(false)
                      setBody('')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="diff-layout">
        <aside className="file-list">
          <h3>Files</h3>
          <ul>
            {files.map((f) => {
              const count = lineComments.filter((c) => c.path === f.path).length
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    className={f.path === activeFile?.path ? 'active' : ''}
                    onClick={() => selectFile(f.path)}
                  >
                    <span className={`status status-${f.status}`}>{f.status[0]!.toUpperCase()}</span>
                    <span className="path">{f.path}</span>
                    {count > 0 ? <span className="badge">{count}</span> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <div className="diff-pane">
          {activeFile ? (
            <>
              <div className="diff-file-header">
                <strong>{activeFile.path}</strong>
                <span className="muted">{activeFile.status}</span>
              </div>
              <div className="unified-diff">
                {activeFile.lines.map((line, idx) => {
                  if (line.type === 'meta') {
                    return (
                      <div key={idx} className="diff-line meta">
                        <span className="gutter" />
                        <span className="gutter" />
                        <span className="gutter sign" />
                        <pre className="line-code">{line.content}</pre>
                      </div>
                    )
                  }

                  const lineNo = lineNumberFor(line)
                  const related = lineComments.filter((c) =>
                    matchesLineComment(c, activeFile.path, line),
                  )
                  const canComment = lineNo !== null
                  const sign =
                    line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '

                  return (
                    <div key={idx} className="diff-line-block">
                      <div className={`diff-line ${line.type}`}>
                        <span className="gutter">{line.oldLine ?? ''}</span>
                        <span className="gutter">{line.newLine ?? ''}</span>
                        <span className="gutter sign" aria-hidden="true">
                          {sign}
                        </span>
                        <button
                          type="button"
                          className="line-body"
                          disabled={!canComment}
                          onClick={() => {
                            if (lineNo === null || line.type === 'meta') return
                            setDraftMessage(false)
                            setDraftLine({
                              path: activeFile.path,
                              line: lineNo,
                              lineType: line.type,
                              snippet: line.content,
                            })
                            setBody('')
                          }}
                        >
                          <pre className="line-code">{line.content || ' '}</pre>
                        </button>
                      </div>
                      {related.map((c) => (
                        <div key={c.id} className="comment-thread inline">
                          <p>{c.body}</p>
                          <button
                            type="button"
                            className="btn link"
                            disabled={busy}
                            onClick={() => onDelete(c.id)}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                      {draftLine &&
                      draftLine.path === activeFile.path &&
                      draftLine.line === lineNo &&
                      draftLine.lineType === line.type ? (
                        <div className="comment-draft inline">
                          <textarea
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            placeholder="Leave a comment"
                            rows={3}
                            autoFocus
                          />
                          <div className="draft-actions">
                            <button
                              type="button"
                              className="btn"
                              disabled={busy}
                              onClick={submitLine}
                            >
                              Save comment
                            </button>
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={() => {
                                setDraftLine(null)
                                setBody('')
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <p className="empty">No files in this commit.</p>
          )}
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  )
}
