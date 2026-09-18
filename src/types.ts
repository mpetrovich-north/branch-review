export type LineType = 'added' | 'removed' | 'unchanged'

export type LineComment = {
  id: string
  kind: 'line'
  commitSha: string
  path: string
  line: number
  lineType: LineType
  snippet?: string
  body: string
  createdAt: string
}

export type FileComment = {
  id: string
  kind: 'file'
  commitSha: string
  path: string
  body: string
  createdAt: string
}

export type CommitComment = {
  id: string
  kind: 'commit'
  commitSha: string
  body: string
  createdAt: string
}

export type Comment = LineComment | FileComment | CommitComment

export type MessageEdit = {
  subject?: string
  body?: string
}

export type CommentsFile = {
  version: 1
  branch: string
  baseBranch: string
  updatedAt: string
  comments: Comment[]
  messageEdits: Record<string, MessageEdit>
}

export type ReviewConfig = {
  baseBranch: string
  reviewBranch: string
}

export type StoredConfig = {
  baseBranch: string
  reviewBranch?: string
}

export type CommitSummary = {
  sha: string
  shortSha: string
  subject: string
  body: string
  authorName: string
  authorEmail: string
  authoredAt: string
}

export type DiffLine = {
  type: 'added' | 'removed' | 'unchanged' | 'meta'
  content: string
  oldLine: number | null
  newLine: number | null
}

export type DiffFile = {
  path: string
  oldPath: string | null
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  lines: DiffLine[]
}

export type BaseSuggestion = {
  baseBranch: string
  kind: 'stack' | 'default' | 'upstream'
  detail: string
}

export type RepoInfo = {
  path: string
  name: string
}

export type MetaResponse = {
  repoPath: string
  checkedOutBranch: string | null
  config: StoredConfig | null
  branches: string[]
  defaultBaseBranch: string
  defaultReviewBranch: string | null
  suggestedBase: BaseSuggestion | null
}
