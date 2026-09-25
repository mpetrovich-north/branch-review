import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
} from 'react'
import type {
  Comment,
  CommentsFile,
  CommitSummary,
  DiffFile,
  FileComment,
  LineComment,
  LineType,
  MessageEdit,
} from './types'
import { createComment, removeComment, setReviewed, updateComment, upsertMessageEdit } from './api'
import { buildFileTree, collectDirPaths, type FileTreeNode } from './fileTree'
import {
  CheckboxIcon,
  CommentBubbleIcon,
  CommitIcon,
  EditIcon,
  FileIcon,
  FolderIcon,
  StatusIcon,
  TrashIcon,
} from './icons'
import { useHighlightedDiff, type LineTokens } from './highlight'
import type { ThemedToken } from 'shiki'

function isSaveShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey)
}

function DraftActions({
  busy = false,
  saveDisabled = false,
  onSave,
  onCancel,
  onReset,
  onDelete,
}: {
  busy?: boolean
  saveDisabled?: boolean
  onSave: () => void
  onCancel: () => void
  onReset?: () => void
  onDelete?: () => void
}) {
  return (
    <div className="draft-actions">
      <button
        type="button"
        className="btn"
        disabled={busy || saveDisabled}
        onClick={onSave}
      >
        Save
      </button>
      <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      {onReset ? (
        <button type="button" className="draft-reset" disabled={busy} onClick={onReset}>
          Reset
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          className="comment-icon-btn comment-delete-btn"
          title="Delete comment"
          aria-label="Delete comment"
          disabled={busy}
          onClick={onDelete}
        >
          <TrashIcon />
        </button>
      ) : null}
    </div>
  )
}

type Props = {
  commit: CommitSummary
  files: DiffFile[]
  comments: Comment[]
  messageEdit: MessageEdit | undefined
  reviewed: boolean
  onReviewFileChange: (file: CommentsFile) => void
  initialFilePath?: string | null
  onFilePathChange?: (path: string | null) => void
  nav: {
    index: number
    total: number
    onPrev: () => void
    onNext: () => void
    canPrev?: boolean
    canNext?: boolean
  }
}

function fileAnchorId(path: string): string {
  return `file-diff-${encodeURIComponent(path)}`
}

function CommitBodyDisplay({ body }: { body: string }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [needsToggle, setNeedsToggle] = useState(false)

  useLayoutEffect(() => {
    setExpanded(false)
    setNeedsToggle(false)
  }, [body])

  useLayoutEffect(() => {
    if (expanded) return
    const el = preRef.current
    if (!el) return
    setNeedsToggle(el.scrollHeight > el.clientHeight + 1)
  }, [body, expanded])

  return (
    <div className="commit-body-wrap">
      <pre
        ref={preRef}
        className={`commit-body${expanded ? '' : ' is-clamped'}`}
      >
        {body}
      </pre>
      {needsToggle ? (
        <button
          type="button"
          className="btn link commit-body-toggle"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  )
}

function EditableCommitText({
  kind,
  original,
  edited,
  busy,
  onSave,
  onReset,
}: {
  kind: 'subject' | 'body'
  original: string
  edited: string | undefined
  busy: boolean
  onSave: (value: string) => Promise<void>
  onReset: () => Promise<void>
}) {
  const display = edited ?? original
  const isEdited = edited !== undefined
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(display)

  useEffect(() => {
    if (!editing) setDraft(display)
  }, [display, editing])

  useEffect(() => {
    setEditing(false)
  }, [original, edited])

  async function save() {
    const next = kind === 'subject' ? draft.trim() : draft.replace(/\n+$/, '')
    if (kind === 'subject' && !next) return
    if (next === original) {
      if (isEdited) await onReset()
      setEditing(false)
      return
    }
    if (next === display) {
      setEditing(false)
      return
    }
    await onSave(next)
    setEditing(false)
  }

  function beginEdit() {
    if (busy) return
    setDraft(display)
    setEditing(true)
  }

  function onEditorKeyDown(e: { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault: () => void }) {
    if (!isSaveShortcut(e)) return
    e.preventDefault()
    if (!busy) void save()
  }

  return (
    <div
      className={`commit-display commit-display-${kind}${editing ? ' is-editing' : ''}`}
    >
      <div
        className="commit-display-main"
        role={editing ? undefined : 'button'}
        tabIndex={editing ? undefined : 0}
        aria-hidden={editing || undefined}
        onClick={
          editing
            ? undefined
            : (e) => {
                if ((e.target as HTMLElement).closest('button')) return
                beginEdit()
              }
        }
        onKeyDown={
          editing
            ? undefined
            : (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  beginEdit()
                }
              }
        }
      >
        <div className={`commit-display-content${isEdited ? ' is-edited' : ''}`}>
          {!editing ? (
            <button
              type="button"
              className="commit-edit-trigger"
              title={kind === 'subject' ? 'Click to edit subject' : 'Click to edit description'}
              aria-label={kind === 'subject' ? 'Click to edit subject' : 'Click to edit description'}
              disabled={busy}
              onClick={beginEdit}
            >
              Click to edit
            </button>
          ) : null}
          {kind === 'subject' ? (
            <h2>{display}</h2>
          ) : display ? (
            <CommitBodyDisplay body={display} />
          ) : (
            <p className="muted commit-body-empty">No message body</p>
          )}
        </div>
        {isEdited ? (
          <span className="commit-edited-label" title={`Original: ${original || '(empty)'}`}>
            Edited
          </span>
        ) : null}
      </div>
      {editing ? (
        <div className={`commit-edit commit-edit-overlay commit-edit-${kind}`}>
          {kind === 'subject' ? (
            <input
              className="commit-edit-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              autoFocus
              aria-label="Commit subject"
              onKeyDown={onEditorKeyDown}
            />
          ) : (
            <textarea
              className="commit-edit-input commit-edit-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
              autoFocus
              aria-label="Commit description"
              onKeyDown={onEditorKeyDown}
            />
          )}
          <DraftActions
            busy={busy}
            saveDisabled={kind === 'subject' && !draft.trim()}
            onSave={() => void save()}
            onCancel={() => {
              setEditing(false)
              setDraft(display)
            }}
            onReset={
              isEdited
                ? () => {
                    void onReset().then(() => {
                      setEditing(false)
                      setDraft(original)
                    })
                  }
                : undefined
            }
          />
        </div>
      ) : null}
    </div>
  )
}

function lineNumberFor(line: DiffFile['lines'][number]): number | null {
  if (line.type === 'removed') return line.oldLine
  if (line.type === 'added' || line.type === 'unchanged') return line.newLine
  return null
}

function LineCode({
  content,
  tokens,
}: {
  content: string
  tokens: ThemedToken[] | null | undefined
}) {
  if (!tokens) {
    return <pre className="line-code">{content || ' '}</pre>
  }
  if (tokens.length === 0) {
    return <pre className="line-code">{' '}</pre>
  }
  return (
    <pre className="line-code">
      {tokens.map((token, i) => (
        <span key={i} style={token.htmlStyle as CSSProperties | undefined}>
          {token.content}
        </span>
      ))}
    </pre>
  )
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

  function beginEdit() {
    if (busy) return
    setDraft(comment.body)
    setEditing(true)
  }

  return (
    <div
      className={`comment-thread${editing ? ' is-editing' : ''}${className ? ` ${className}` : ''}`}
    >
      <div className="comment-view" aria-hidden={editing || undefined}>
        <button
          type="button"
          className="comment-icon-btn comment-edit-btn"
          title="Edit comment"
          aria-label="Edit comment"
          disabled={busy || editing}
          onClick={beginEdit}
        >
          <EditIcon />
        </button>
        <button
          type="button"
          className="comment-body-hit"
          disabled={busy || editing}
          onClick={beginEdit}
        >
          {comment.body}
        </button>
        <button
          type="button"
          className="comment-icon-btn comment-delete-btn"
          title="Delete comment"
          aria-label="Delete comment"
          disabled={busy || editing}
          onClick={() => void onDelete(comment.id)}
        >
          <TrashIcon />
        </button>
      </div>
      {editing ? (
        <div className="compose-panel comment-edit-overlay">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (!isSaveShortcut(e)) return
              e.preventDefault()
              if (!busy) void save()
            }}
          />
          <DraftActions
            busy={busy}
            onSave={() => void save()}
            onCancel={() => {
              setEditing(false)
              setDraft(comment.body)
            }}
            onDelete={() => void onDelete(comment.id)}
          />
        </div>
      ) : null}
    </div>
  )
}

type NameHover = {
  text: string
  path: string
  kind: 'file' | 'dir'
  rowTop: number
  rowLeft: number
  rowHeight: number
  rowWidth: number
  textLeft: number
  textTop: number
  textHeight: number
  rails: { left: number }[]
}

function FileTree({
  nodes,
  depth,
  activePath,
  expanded,
  commentCounts,
  overflowHoverPath,
  onToggleDir,
  onSelectFile,
  onNameHover,
  onNameLeave,
}: {
  nodes: FileTreeNode[]
  depth: number
  activePath: string | undefined
  expanded: Set<string>
  commentCounts: Map<string, number>
  overflowHoverPath: string | null
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
  onNameHover: (
    event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>,
    path: string,
    text: string,
    kind: 'file' | 'dir',
  ) => void
  onNameLeave: () => void
}) {
  return (
    <ul className={depth === 0 ? 'file-tree' : 'file-tree-nested'} role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((node) => {
        // Indent content; hover/active fill starts after the horizontal branch tip.
        const padLeft = `${0.45 + depth * 0.7}rem`
        const branchLeftRem = depth > 0 ? 0.45 + (depth - 1) * 0.7 + 0.28 : 0
        const branchWidthRem = 0.95
        const hoverInset =
          depth > 0 ? `${branchLeftRem + branchWidthRem}rem` : '0px'
        const rowStyle = {
          paddingLeft: padLeft,
          ['--tree-hover-inset' as string]: hoverInset,
        }

        if (node.kind === 'dir') {
          const isOpen = expanded.has(node.path)
          const railLeft = `${0.45 + depth * 0.7 + 0.28}rem`
          const label = `${node.name}/`
          const isOverflowHover = overflowHoverPath === node.path
          return (
            <li key={`dir:${node.path}`} role="treeitem" aria-expanded={isOpen}>
              <button
                type="button"
                className={`file-tree-dir${isOverflowHover ? ' is-overflow-hover' : ''}`}
                style={rowStyle}
                aria-expanded={isOpen}
                onClick={() => onToggleDir(node.path)}
                onMouseEnter={(e) => onNameHover(e, node.path, label, 'dir')}
                onMouseLeave={onNameLeave}
                onFocus={(e) => onNameHover(e, node.path, label, 'dir')}
                onBlur={onNameLeave}
              >
                <span className="file-tree-chevron" aria-hidden="true">
                  {isOpen ? '▾' : '▸'}
                </span>
                <FolderIcon className="file-tree-icon" />
                <span className="file-tree-name">{label}</span>
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
                    overflowHoverPath={overflowHoverPath}
                    onToggleDir={onToggleDir}
                    onSelectFile={onSelectFile}
                    onNameHover={onNameHover}
                    onNameLeave={onNameLeave}
                  />
                </div>
              ) : null}
            </li>
          )
        }

        const count = commentCounts.get(node.path) ?? 0
        const isActive = node.path === activePath
        const isOverflowHover = overflowHoverPath === node.path
        return (
          <li key={`file:${node.path}`} role="treeitem">
            <button
              type="button"
              className={`file-tree-file${isActive ? ' active' : ''}${isOverflowHover ? ' is-overflow-hover' : ''}`}
              style={rowStyle}
              onClick={() => onSelectFile(node.path)}
              onMouseEnter={(e) => onNameHover(e, node.path, node.name, 'file')}
              onMouseLeave={onNameLeave}
              onFocus={(e) => onNameHover(e, node.path, node.name, 'file')}
              onBlur={onNameLeave}
            >
              {depth > 0 ? (
                <span
                  className="file-tree-branch"
                  style={{ left: `${0.45 + (depth - 1) * 0.7 + 0.28}rem` }}
                  aria-hidden="true"
                />
              ) : null}
              <span className="file-tree-chevron file-tree-chevron-spacer" aria-hidden="true" />
              <span className={`status status-${node.file.status}`}>
                <StatusIcon status={node.file.status} />
              </span>
              <FileIcon className="file-tree-icon" />
              <span className="file-tree-name">{node.name}</span>
              {count > 0 ? <span className="badge">{count}</span> : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function FileDiffSection({
  file,
  lineComments,
  fileComments,
  draftLine,
  draftFilePath,
  body,
  busy,
  setBody,
  onStartLineComment,
  onStartFileComment,
  onSubmitLine,
  onSubmitFile,
  onClearDrafts,
  onEdit,
  onDelete,
}: {
  file: DiffFile
  lineComments: LineComment[]
  fileComments: FileComment[]
  draftLine: {
    path: string
    line: number
    lineType: LineType
    snippet: string
  } | null
  draftFilePath: string | null
  body: string
  busy: boolean
  setBody: (value: string) => void
  onStartLineComment: (args: {
    path: string
    line: number
    lineType: LineType
    snippet: string
  }) => void
  onStartFileComment: (path: string) => void
  onSubmitLine: () => void
  onSubmitFile: () => void
  onClearDrafts: () => void
  onEdit: (id: string, body: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const highlighted: LineTokens[] | null = useHighlightedDiff(file)

  return (
    <section id={fileAnchorId(file.path)} className="diff-file" data-file-path={file.path}>
      <div className="diff-file-header">
        <div className="diff-file-title">
          <span className={`status status-${file.status}`}>
            <StatusIcon status={file.status} />
          </span>
          <FileIcon className="diff-file-icon" />
          <strong>{file.path}</strong>
        </div>
        <button
          type="button"
          className="comment-bubble"
          title="Comment on this file"
          aria-label="Comment on this file"
          onClick={() => onStartFileComment(file.path)}
        >
          <CommentBubbleIcon />
          Comment
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
      {draftFilePath === file.path ? (
        <div className="comment-compose file-level">
          <div className="compose-panel">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Comment on this file"
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (!isSaveShortcut(e)) return
                e.preventDefault()
                if (!busy) onSubmitFile()
              }}
            />
            <DraftActions
              busy={busy}
              saveDisabled={!body.trim()}
              onSave={onSubmitFile}
              onCancel={onClearDrafts}
            />
          </div>
        </div>
      ) : null}
      <div className="unified-diff">
        <div className="unified-diff-content">
          {file.lines.map((line, idx) => {
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
            const related = lineComments.filter((c) => matchesLineComment(c, file.path, line))
            const canComment = lineNo !== null

            return (
              <div key={idx} className="diff-line-block">
                <div className={`diff-line ${line.type}`}>
                  <span className="gutter gutter-old">{line.oldLine ?? ''}</span>
                  <span className="gutter gutter-new">{line.newLine ?? ''}</span>
                  <button
                    type="button"
                    className="line-body"
                    disabled={!canComment}
                    onClick={() => {
                      if (lineNo === null || line.type === 'meta') return
                      onStartLineComment({
                        path: file.path,
                        line: lineNo,
                        lineType: line.type,
                        snippet: line.content,
                      })
                    }}
                  >
                    <LineCode content={line.content} tokens={highlighted?.[idx]} />
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
                draftLine.path === file.path &&
                draftLine.line === lineNo &&
                draftLine.lineType === line.type ? (
                  <div className="comment-compose inline">
                    <div className="compose-panel">
                      <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="Comment on this line"
                        rows={3}
                        autoFocus
                        onKeyDown={(e) => {
                          if (!isSaveShortcut(e)) return
                          e.preventDefault()
                          if (!busy) onSubmitLine()
                        }}
                      />
                      <DraftActions
                        busy={busy}
                        saveDisabled={!body.trim()}
                        onSave={onSubmitLine}
                        onCancel={onClearDrafts}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

const SCROLL_SPY_OFFSET = 96
const FILE_LIST_WIDTH_MAX = 480

/** Intrinsic width needed to show every visible name (and badge) without clipping. */
function measureFileListContentWidth(list: HTMLElement): number {
  const listLeft = list.getBoundingClientRect().left
  const listStyle = getComputedStyle(list)
  const padRight = Number.parseFloat(listStyle.paddingRight) || 0
  const borderRight = Number.parseFloat(listStyle.borderRightWidth) || 0
  // border-box width must cover content end + list padding-right + border-right.
  const trailing = padRight + borderRight
  let needed = 0

  const heading = list.querySelector('h3') as HTMLElement | null
  if (heading) {
    needed = Math.max(
      needed,
      heading.getBoundingClientRect().left + heading.scrollWidth - listLeft + trailing,
    )
  }

  for (const name of list.querySelectorAll('.file-tree-name')) {
    const el = name as HTMLElement
    const row = el.closest('.file-tree-file, .file-tree-dir') as HTMLElement | null
    if (!row) continue

    const rowStyle = getComputedStyle(row)
    const rowPadRight = Number.parseFloat(rowStyle.paddingRight) || 0
    const gap = Number.parseFloat(rowStyle.columnGap || rowStyle.gap) || 0
    const badge = row.querySelector('.badge') as HTMLElement | null

    // scrollWidth equals the flex slot when text is not clipped; use a Range for
    // the real glyph width so short labels do not inflate, and long ones stay exact.
    let nameWidth = el.scrollWidth
    if (el.scrollWidth <= el.clientWidth + 1) {
      const range = document.createRange()
      range.selectNodeContents(el)
      nameWidth = range.getBoundingClientRect().width
    }

    let contentEnd = el.getBoundingClientRect().left + nameWidth
    if (badge) {
      contentEnd += gap + badge.getBoundingClientRect().width
    }
    contentEnd += rowPadRight

    needed = Math.max(needed, contentEnd - listLeft + trailing)
  }

  // Subpixel AA / rounding can still clip by a hair without a small buffer.
  return Math.min(FILE_LIST_WIDTH_MAX, Math.ceil(needed + 1))
}

export function CommitReview({
  commit,
  files,
  comments,
  messageEdit,
  reviewed,
  onReviewFileChange,
  initialFilePath,
  onFilePathChange,
  nav,
}: Props) {
  const [activePath, setActivePath] = useState(() => {
    if (initialFilePath && files.some((f) => f.path === initialFilePath)) {
      return initialFilePath
    }
    return files[0]?.path ?? ''
  })
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set())
  const [draftLine, setDraftLine] = useState<{
    path: string
    line: number
    lineType: LineType
    snippet: string
  } | null>(null)
  const [draftCommit, setDraftCommit] = useState(false)
  const [draftFilePath, setDraftFilePath] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollingToRef = useRef<string | null>(null)
  const [nameHover, setNameHover] = useState<NameHover | null>(null)
  const fileListRef = useRef<HTMLElement | null>(null)
  const fileListWidthFloorRef = useRef(0)
  const fileListWidthShaRef = useRef(commit.sha)
  const [fileListWidth, setFileListWidth] = useState(0)
  const [fileListCollapsed, setFileListCollapsed] = useState(false)
  const [fileListScrollHidden, setFileListScrollHidden] = useState(false)
  const fileListCollapsedRef = useRef(fileListCollapsed)
  fileListCollapsedRef.current = fileListCollapsed

  function toggleFileListCollapsed() {
    setFileListCollapsed((prev) => {
      if (prev) setFileListScrollHidden(false)
      return !prev
    })
  }

  function onFileListChipClick() {
    if (fileListCollapsed) {
      setFileListCollapsed(false)
      setFileListScrollHidden(false)
      return
    }
    // Expanded but faded: bring the pane back.
    if (fileListScrollHidden) setFileListScrollHidden(false)
  }

  function onFileListChipToggleClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    // Pane is faded: first click restores it (chip looks collapsed while faded).
    if (!fileListCollapsed && fileListScrollHidden) {
      setFileListScrollHidden(false)
      return
    }
    toggleFileListCollapsed()
  }

  const chipCaretCollapsed = fileListCollapsed || fileListScrollHidden

  const fileTree = useMemo(() => buildFileTree(files), [files])

  function handleNameHover(
    event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>,
    path: string,
    text: string,
    kind: 'file' | 'dir',
  ) {
    const row = event.currentTarget
    const nameEl = row.querySelector('.file-tree-name') as HTMLElement | null
    if (!nameEl) {
      setNameHover(null)
      return
    }
    if (nameEl.scrollWidth <= nameEl.clientWidth + 1) {
      setNameHover(null)
      return
    }
    const rowRect = row.getBoundingClientRect()
    const nameRect = nameEl.getBoundingClientRect()
    const rightPad = 8
    const tree = row.closest('.file-tree')
    const rails: { left: number }[] = []
    if (tree) {
      for (const rail of tree.querySelectorAll('.file-tree-rail')) {
        const railRect = (rail as HTMLElement).getBoundingClientRect()
        if (railRect.bottom <= rowRect.top || railRect.top >= rowRect.bottom) continue
        rails.push({ left: railRect.left - rowRect.left })
      }
    }
    setNameHover({
      text,
      path,
      kind,
      rowTop: rowRect.top,
      rowLeft: rowRect.left,
      rowHeight: rowRect.height,
      rowWidth: nameRect.left - rowRect.left + nameEl.scrollWidth + rightPad,
      textLeft: nameRect.left - rowRect.left,
      textTop: nameRect.top - rowRect.top,
      textHeight: nameRect.height,
      rails,
    })
  }

  function handleNameLeave() {
    setNameHover(null)
  }

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
    setDraftFilePath(null)
    setBody('')
  }

  function selectFile(path: string) {
    clearDrafts()
    scrollingToRef.current = path
    setActivePath(path)
    const el = document.getElementById(fileAnchorId(path))
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => {
      if (scrollingToRef.current === path) scrollingToRef.current = null
    }, 700)
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
    const preferred =
      initialFilePath && files.some((f) => f.path === initialFilePath)
        ? initialFilePath
        : (files[0]?.path ?? '')
    setActivePath(preferred)
    clearDrafts()
    setExpandedDirs(new Set(collectDirPaths(fileTree)))
    setNameHover(null)
    setFileListCollapsed(false)
    setFileListScrollHidden(window.scrollY > 8)
  }, [commit.sha, files, fileTree, initialFilePath])

  // Grow the floating file list to fit visible labels; never shrink on collapse.
  useLayoutEffect(() => {
    if (fileListCollapsed) return
    const list = fileListRef.current
    if (!list) return

    if (fileListWidthShaRef.current !== commit.sha) {
      fileListWidthShaRef.current = commit.sha
      fileListWidthFloorRef.current = 0
    }

    const needed = measureFileListContentWidth(list)
    const next = Math.max(fileListWidthFloorRef.current, needed)
    fileListWidthFloorRef.current = next
    setFileListWidth((prev) => (prev === next ? prev : next))
  }, [commit.sha, expandedDirs, files, commentCounts, fileTree, fileListCollapsed])

  useEffect(() => {
    let lastY = window.scrollY
    let traveled = 0
    let settleTimer = 0

    const atTop = () => window.scrollY <= 8

    const onScroll = () => {
      if (fileListCollapsedRef.current) return

      const y = window.scrollY
      traveled += Math.abs(y - lastY)
      lastY = y

      if (atTop() || fileListRef.current?.matches(':hover')) {
        traveled = 0
        setFileListScrollHidden(false)
      } else if (traveled > 24) {
        // Show while the user is actively scrolling.
        setFileListScrollHidden(false)
      }

      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        traveled = 0
        if (fileListCollapsedRef.current) return
        // Hide when idle away from the top (unless the pane is hovered).
        if (!atTop() && !fileListRef.current?.matches(':hover')) {
          setFileListScrollHidden(true)
        }
      }, 450)
    }

    // Start hidden unless we are already at the top.
    setFileListScrollHidden(!atTop())

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.clearTimeout(settleTimer)
    }
  }, [])

  useEffect(() => {
    onFilePathChange?.(activePath || null)
  }, [activePath, onFilePathChange])

  useEffect(() => {
    if (!nameHover) return
    const clear = () => setNameHover(null)
    window.addEventListener('scroll', clear, true)
    window.addEventListener('resize', clear)
    return () => {
      window.removeEventListener('scroll', clear, true)
      window.removeEventListener('resize', clear)
    }
  }, [nameHover])

  useEffect(() => {
    if (files.length === 0) return

    const updateActiveFromScroll = () => {
      if (scrollingToRef.current) return
      let current = files[0]!.path
      for (const file of files) {
        const el = document.getElementById(fileAnchorId(file.path))
        if (!el) continue
        if (el.getBoundingClientRect().top <= SCROLL_SPY_OFFSET) {
          current = file.path
        }
      }
      setActivePath((prev) => (prev === current ? prev : current))
    }

    updateActiveFromScroll()
    window.addEventListener('scroll', updateActiveFromScroll, { passive: true })
    window.addEventListener('resize', updateActiveFromScroll)
    return () => {
      window.removeEventListener('scroll', updateActiveFromScroll)
      window.removeEventListener('resize', updateActiveFromScroll)
    }
  }, [files, commit.sha])

  const commitComments = comments.filter(
    (c) => c.kind === 'commit' && c.commitSha === commit.sha,
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
      onReviewFileChange(file)
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
      onReviewFileChange(file)
      clearDrafts()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save comment')
    } finally {
      setBusy(false)
    }
  }

  async function submitFile() {
    if (!draftFilePath || !body.trim()) return
    setBusy(true)
    setError(null)
    try {
      const file = await createComment({
        kind: 'file',
        commitSha: commit.sha,
        path: draftFilePath,
        body: body.trim(),
      })
      onReviewFileChange(file)
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
      onReviewFileChange(file)
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
      onReviewFileChange(file)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete comment')
    } finally {
      setBusy(false)
    }
  }

  async function saveMessageField(field: 'subject' | 'body', value: string) {
    setBusy(true)
    setError(null)
    try {
      const file = await upsertMessageEdit(commit.sha, { [field]: value })
      onReviewFileChange(file)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save message edit')
    } finally {
      setBusy(false)
    }
  }

  async function resetMessageField(field: 'subject' | 'body') {
    setBusy(true)
    setError(null)
    try {
      const file = await upsertMessageEdit(commit.sha, { [field]: null })
      onReviewFileChange(file)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset message edit')
    } finally {
      setBusy(false)
    }
  }

  async function toggleReviewed() {
    setBusy(true)
    setError(null)
    try {
      const file = await setReviewed(commit.sha, !reviewed)
      onReviewFileChange(file)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update reviewed state')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="commit-review">
      <section className="commit-message-panel">
        <div className="commit-message-header">
          <div className="commit-title-block">
            <EditableCommitText
              kind="subject"
              original={commit.subject}
              edited={messageEdit?.subject}
              busy={busy}
              onSave={(value) => saveMessageField('subject', value)}
              onReset={() => resetMessageField('subject')}
            />
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
              title="Comment on this commit"
              aria-label="Comment on this commit"
              onClick={() => {
                setDraftCommit(true)
                setDraftLine(null)
                setDraftFilePath(null)
                setBody('')
              }}
            >
              <CommentBubbleIcon />
              Comment
            </button>
            <button
              type="button"
              className={`reviewed-toggle${reviewed ? ' is-reviewed' : ''}`}
              title={reviewed ? 'Mark as not reviewed' : 'Mark as reviewed'}
              aria-label={reviewed ? 'Mark as not reviewed' : 'Mark as reviewed'}
              aria-pressed={reviewed}
              disabled={busy}
              onClick={() => void toggleReviewed()}
            >
              <CheckboxIcon checked={reviewed} />
              Reviewed
            </button>
            <div className="commit-nav">
              <button
                type="button"
                className="btn ghost"
                disabled={!(nav.canPrev ?? nav.index > 0)}
                onClick={nav.onPrev}
              >
                Previous
              </button>
              <span className="commit-nav-index">
                {nav.index + 1} / {nav.total}
              </span>
              <button
                type="button"
                className="btn ghost"
                disabled={!(nav.canNext ?? (nav.index >= 0 && nav.index < nav.total - 1))}
                onClick={nav.onNext}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div className="commit-message-content">
          <EditableCommitText
            kind="body"
            original={commit.body}
            edited={messageEdit?.body}
            busy={busy}
            onSave={(value) => saveMessageField('body', value)}
            onReset={() => resetMessageField('body')}
          />
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
            <div className="comment-compose">
              <div className="compose-panel">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Comment on this commit"
                  rows={3}
                  autoFocus
                  onKeyDown={(e) => {
                    if (!isSaveShortcut(e)) return
                    e.preventDefault()
                    if (!busy) void submitCommit()
                  }}
                />
                <DraftActions
                  busy={busy}
                  saveDisabled={!body.trim()}
                  onSave={() => void submitCommit()}
                  onCancel={clearDrafts}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <div
        className="diff-layout"
        style={
          {
            '--file-list-width': fileListWidth > 0 ? `${fileListWidth}px` : 'max-content',
          } as CSSProperties
        }
      >
        <div className="diff-files">
          {files.length === 0 ? (
            <p className="empty">No files in this commit.</p>
          ) : (
            files.map((file) => (
              <FileDiffSection
                key={file.path}
                file={file}
                lineComments={lineComments.filter((c) => c.path === file.path)}
                fileComments={comments.filter(
                  (c): c is FileComment =>
                    c.kind === 'file' && c.commitSha === commit.sha && c.path === file.path,
                )}
                draftLine={draftLine}
                draftFilePath={draftFilePath}
                body={body}
                busy={busy}
                setBody={setBody}
                onStartLineComment={(args) => {
                  setDraftCommit(false)
                  setDraftFilePath(null)
                  setDraftLine(args)
                  setBody('')
                }}
                onStartFileComment={(path) => {
                  setDraftFilePath(path)
                  setDraftCommit(false)
                  setDraftLine(null)
                  setBody('')
                }}
                onSubmitLine={() => void submitLine()}
                onSubmitFile={() => void submitFile()}
                onClearDrafts={clearDrafts}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
        <aside
          className="file-list-chip"
          onClick={onFileListChipClick}
        >
          <div className="file-list-heading">
            <h3>
              {files.length} {files.length === 1 ? 'file' : 'files'}
            </h3>
            <button
              type="button"
              className="file-list-toggle"
              aria-expanded={!fileListCollapsed && !fileListScrollHidden}
              aria-label={chipCaretCollapsed ? 'Expand file list' : 'Collapse file list'}
              title={chipCaretCollapsed ? 'Expand file list' : 'Collapse file list'}
              onClick={onFileListChipToggleClick}
            >
              <svg
                className={`file-list-toggle-icon${chipCaretCollapsed ? ' is-collapsed' : ''}`}
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
            </button>
          </div>
        </aside>
        {!fileListCollapsed ? (
          <aside
            className={`file-list${fileListScrollHidden ? ' is-scroll-hidden' : ''}`}
            ref={fileListRef}
          >
            <div className="file-list-heading">
              <h3>
                {files.length} {files.length === 1 ? 'file' : 'files'}
              </h3>
            </div>
            {files.length === 0 ? (
              <p className="empty">No files in this commit.</p>
            ) : (
              <FileTree
                nodes={fileTree}
                depth={0}
                activePath={activePath || undefined}
                expanded={expandedDirs}
                commentCounts={commentCounts}
                overflowHoverPath={nameHover?.path ?? null}
                onToggleDir={toggleDir}
                onSelectFile={selectFile}
                onNameHover={handleNameHover}
                onNameLeave={handleNameLeave}
              />
            )}
          </aside>
        ) : null}
      </div>
      {nameHover ? (
        <div
          className={`file-tree-name-float${nameHover.kind === 'dir' ? ' is-dir' : ''}`}
          style={{
            top: nameHover.rowTop,
            left: nameHover.rowLeft,
            height: nameHover.rowHeight,
            width: nameHover.rowWidth,
          }}
          aria-hidden="true"
        >
          <span
            className="file-tree-name-float-bg"
            style={{ left: nameHover.textLeft }}
          />
          {nameHover.rails.map((rail, i) => (
            <span
              key={i}
              className="file-tree-name-float-rail"
              style={{ left: rail.left }}
            />
          ))}
          <span
            className="file-tree-name-float-label"
            style={{
              left: nameHover.textLeft,
              top: nameHover.textTop,
              height: nameHover.textHeight,
            }}
          >
            {nameHover.text}
          </span>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  )
}
