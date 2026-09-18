import { useEffect, useMemo, useState } from 'react'
import type {
  Comment,
  CommitSummary,
  DiffFile,
  FileComment,
  LineComment,
  LineType,
} from './types'
import { createComment, removeComment, updateComment } from './api'
import { buildFileTree, collectDirPaths, type FileTreeNode } from './fileTree'
import {
  CommentBubbleIcon,
  CommitIcon,
  FileIcon,
  FolderIcon,
  StatusIcon,
} from './icons'

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

function EditableComment({
  comment,
  busy,
  onSave,
  onDelete,
  className,
}: {
  comment: Comment
  busy: boolean
  onSave: (id: string, body: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)

  useEffect(() => {
    if (!editing) setDraft(comment.body)
  }, [comment.body, editing])

  async function save() {
    if (!draft.trim() || draft.trim() === comment.body) {
      setEditing(false)
      setDraft(comment.body)
      return
    }
    await onSave(comment.id, draft.trim())
    setEditing(false)
  }

  return (
    <div className={className ? `comment-thread ${className}` : 'comment-thread'}>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
          />
          <div className="draft-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
              Save
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                setEditing(false)
                setDraft(comment.body)
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{comment.body}</p>
          <div className="comment-actions">
            <button
              type="button"
              className="btn link"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn link"
              disabled={busy}
              onClick={() => void onDelete(comment.id)}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function FileTree({
  nodes,
  depth,
  activePath,
  expanded,
  commentCounts,
  onToggleDir,
  onSelectFile,
}: {
  nodes: FileTreeNode[]
  depth: number
  activePath: string | undefined
  expanded: Set<string>
  commentCounts: Map<string, number>
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
}) {
  return (
    <ul className={depth === 0 ? 'file-tree' : 'file-tree-nested'} role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((node) => {
        if (node.kind === 'dir') {
          const isOpen = expanded.has(node.path)
          const railLeft = `${0.45 + depth * 0.7 + 0.28}rem`
          return (
            <li key={`dir:${node.path}`} role="treeitem" aria-expanded={isOpen}>
              <button
                type="button"
                className="file-tree-dir"
                style={{ paddingLeft: `${0.45 + depth * 0.7}rem` }}
                aria-expanded={isOpen}
                onClick={() => onToggleDir(node.path)}
              >
                <span className="file-tree-chevron" aria-hidden="true">
                  {isOpen ? '▾' : '▸'}
                </span>
                <FolderIcon className="file-tree-icon" />
                <span className="file-tree-name">{node.name}/</span>
              </button>
              {isOpen ? (
                <div className="file-tree-children">
                  <span className="file-tree-rail" style={{ left: railLeft }} aria-hidden="true" />
                  <FileTree
                    nodes={node.children}
                    depth={depth + 1}
                    activePath={activePath}
                    expanded={expanded}
                    commentCounts={commentCounts}
                    onToggleDir={onToggleDir}
                    onSelectFile={onSelectFile}
                  />
                </div>
              ) : null}
            </li>
          )
        }

        const count = commentCounts.get(node.path) ?? 0
        const isActive = node.path === activePath
        return (
          <li key={`file:${node.path}`} role="treeitem">
            <button
              type="button"
              className={`file-tree-file${isActive ? ' active' : ''}`}
              style={{ paddingLeft: `${0.45 + depth * 0.7}rem` }}
              onClick={() => onSelectFile(node.path)}
            >
              <span className="file-tree-chevron file-tree-chevron-spacer" aria-hidden="true" />
              <span className={`status status-${node.file.status}`}>
                <StatusIcon status={node.file.status} />
              </span>
              <FileIcon className="file-tree-icon" />
              <span className="file-tree-name-wrap">
                <span className="file-tree-name">{node.name}</span>
                <span className="file-tree-name-full" aria-hidden="true">
                  {node.name}
                </span>
              </span>
              {count > 0 ? <span className="badge">{count}</span> : null}
            </button>
          </li>
        )
      })}
    </ul>
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
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set())
  const [draftLine, setDraftLine] = useState<{
    path: string
    line: number
    lineType: LineType
    snippet: string
  } | null>(null)
  const [draftCommit, setDraftCommit] = useState(false)
  const [draftFile, setDraftFile] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fileTree = useMemo(() => buildFileTree(files), [files])

  const commentCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of comments) {
      if (c.commitSha !== commit.sha) continue
      if (c.kind === 'line' || c.kind === 'file') {
        map.set(c.path, (map.get(c.path) ?? 0) + 1)
      }
    }
    return map
  }, [comments, commit.sha])

  function clearDrafts() {
    setDraftLine(null)
    setDraftCommit(false)
    setDraftFile(false)
    setBody('')
  }

  function selectFile(path: string) {
    setActivePath(path)
    clearDrafts()
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function toggleDir(path: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  useEffect(() => {
    setActivePath(files[0]?.path ?? '')
    clearDrafts()
    setExpandedDirs(new Set(collectDirPaths(fileTree)))
  }, [commit.sha, files, fileTree])

  const activeFile = useMemo(
    () => files.find((f) => f.path === activePath) ?? files[0],
    [files, activePath],
  )

  const commitComments = comments.filter(
    (c) => c.kind === 'commit' && c.commitSha === commit.sha,
  )
  const lineComments = comments.filter(
    (c): c is LineComment => c.kind === 'line' && c.commitSha === commit.sha,
  )
  const fileComments = comments.filter(
    (c): c is FileComment =>
      c.kind === 'file' && c.commitSha === commit.sha && c.path === activeFile?.path,
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
      clearDrafts()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save comment')
    } finally {
      setBusy(false)
    }
  }

  async function submitCommit() {
    if (!body.trim()) return
    setBusy(true)
    setError(null)
    try {
      const file = await createComment({
        kind: 'commit',
        commitSha: commit.sha,
        body: body.trim(),
      })
      onCommentsChange(file.comments)
      clearDrafts()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save comment')
    } finally {
      setBusy(false)
    }
  }

  async function submitFile() {
    if (!activeFile || !body.trim()) return
    setBusy(true)
    setError(null)
    try {
      const file = await createComment({
        kind: 'file',
        commitSha: commit.sha,
        path: activeFile.path,
        body: body.trim(),
      })
      onCommentsChange(file.comments)
      clearDrafts()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save comment')
    } finally {
      setBusy(false)
    }
  }

  async function onEdit(id: string, nextBody: string) {
    setBusy(true)
    setError(null)
    try {
      const file = await updateComment(id, nextBody)
      onCommentsChange(file.comments)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update comment')
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
              <span className="sha-with-icon">
                <CommitIcon className="commit-hash-icon" />
                <code className="sha">{commit.shortSha}</code>
              </span>
              <span className="sep">·</span>
              {commit.authorName}
              <span className="sep">·</span>
              {formatCommitTime(commit.authoredAt)}
            </p>
          </div>
          <div className="commit-nav-group">
            <button
              type="button"
              className="comment-bubble"
              title="Comment on commit"
              aria-label="Comment on commit"
              onClick={() => {
                setDraftCommit(true)
                setDraftLine(null)
                setDraftFile(false)
                setBody('')
              }}
            >
              <CommentBubbleIcon />
            </button>
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
        </div>

        <div className="commit-message-content">
          {commit.body ? (
            <pre className="commit-body">{commit.body}</pre>
          ) : (
            <p className="muted commit-body-empty">No message body</p>
          )}
          {commitComments.map((c) => (
            <EditableComment
              key={c.id}
              comment={c}
              busy={busy}
              onSave={onEdit}
              onDelete={onDelete}
            />
          ))}
          {draftCommit ? (
            <div className="comment-draft">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Comment on this commit"
                rows={3}
                autoFocus
              />
              <div className="draft-actions">
                <button type="button" className="btn" disabled={busy} onClick={() => void submitCommit()}>
                  Save comment
                </button>
                <button type="button" className="btn ghost" onClick={clearDrafts}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <div className="diff-layout">
        <aside className="file-list">
          <h3>
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </h3>
          {files.length === 0 ? (
            <p className="empty">No files in this commit.</p>
          ) : (
            <FileTree
              nodes={fileTree}
              depth={0}
              activePath={activeFile?.path}
              expanded={expandedDirs}
              commentCounts={commentCounts}
              onToggleDir={toggleDir}
              onSelectFile={selectFile}
            />
          )}
        </aside>

        <div className="diff-pane">
          {activeFile ? (
            <>
              <div className="diff-file-header">
                <div className="diff-file-title">
                  <span className={`status status-${activeFile.status}`}>
                    <StatusIcon status={activeFile.status} />
                  </span>
                  <FileIcon className="diff-file-icon" />
                  <strong>{activeFile.path}</strong>
                </div>
                <button
                  type="button"
                  className="comment-bubble"
                  title="Comment on file"
                  aria-label="Comment on file"
                  onClick={() => {
                    setDraftFile(true)
                    setDraftCommit(false)
                    setDraftLine(null)
                    setBody('')
                  }}
                >
                  <CommentBubbleIcon />
                </button>
              </div>
              {fileComments.map((c) => (
                <EditableComment
                  key={c.id}
                  comment={c}
                  busy={busy}
                  onSave={onEdit}
                  onDelete={onDelete}
                  className="file-level"
                />
              ))}
              {draftFile ? (
                <div className="comment-draft file-level">
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Comment on this file"
                    rows={3}
                    autoFocus
                  />
                  <div className="draft-actions">
                    <button type="button" className="btn" disabled={busy} onClick={() => void submitFile()}>
                      Save comment
                    </button>
                    <button type="button" className="btn ghost" onClick={clearDrafts}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="unified-diff">
                {activeFile.lines.map((line, idx) => {
                  if (line.type === 'meta') {
                    return (
                      <div key={idx} className="diff-line meta">
                        <span className="gutter gutter-old" />
                        <span className="gutter gutter-new" />
                        <pre className="line-code">{line.content}</pre>
                      </div>
                    )
                  }

                  const lineNo = lineNumberFor(line)
                  const related = lineComments.filter((c) =>
                    matchesLineComment(c, activeFile.path, line),
                  )
                  const canComment = lineNo !== null

                  return (
                    <div key={idx} className="diff-line-block">
                      <div className={`diff-line ${line.type}`}>
                        <span className="gutter gutter-old">
                          {line.type === 'removed' ? (
                            <span className="sign" aria-hidden="true">
                              -
                            </span>
                          ) : (
                            <span className="sign-spacer" aria-hidden="true" />
                          )}
                          <span className="gutter-num">{line.oldLine ?? ''}</span>
                        </span>
                        <span className="gutter gutter-new">
                          {line.type === 'added' ? (
                            <span className="sign" aria-hidden="true">
                              +
                            </span>
                          ) : (
                            <span className="sign-spacer" aria-hidden="true" />
                          )}
                          <span className="gutter-num">{line.newLine ?? ''}</span>
                        </span>
                        <button
                          type="button"
                          className="line-body"
                          disabled={!canComment}
                          onClick={() => {
                            if (lineNo === null || line.type === 'meta') return
                            setDraftCommit(false)
                            setDraftFile(false)
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
                        <EditableComment
                          key={c.id}
                          comment={c}
                          busy={busy}
                          onSave={onEdit}
                          onDelete={onDelete}
                          className="inline"
                        />
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
                              onClick={() => void submitLine()}
                            >
                              Save comment
                            </button>
                            <button type="button" className="btn ghost" onClick={clearDrafts}>
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
