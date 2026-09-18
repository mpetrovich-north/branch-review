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

export type CommitMessageComment = {
  id: string
  kind: 'commit_message'
  commitSha: string
  body: string
  createdAt: string
}

export type Comment = LineComment | CommitMessageComment

export type CommentsFile = {
  version: 1
  branch: string
  baseBranch: string
  updatedAt: string
  comments: Comment[]
}

export type ReviewConfig = {
  baseBranch: string
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

export type MetaResponse = {
  repoPath: string
  branch: string
  config: ReviewConfig | null
  branches: string[]
  defaultBaseBranch: string
}
