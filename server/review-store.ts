import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { ulid } from 'ulid'
import {
  commentsFileSchema,
  configSchema,
  createCommentSchema,
  storedConfigSchema,
  updateCommentSchema,
  type Comment,
  type CommentsFile,
  type ReviewConfig,
} from './schema.js'

export type StoredConfig = {
  baseBranch: string
  reviewBranch?: string
}

const REVIEW_DIR = '.review'
const GITIGNORE_CONTENTS = `*
`

export function branchSlug(branch: string): string {
  return branch.replace(/\//g, '--')
}

function reviewRoot(repoPath: string): string {
  return path.join(repoPath, REVIEW_DIR)
}

function configPath(repoPath: string): string {
  return path.join(reviewRoot(repoPath), 'config.json')
}

function commentsPath(repoPath: string, branch: string): string {
  return path.join(reviewRoot(repoPath), 'comments', `${branchSlug(branch)}.json`)
}

async function ensureReviewDir(repoPath: string): Promise<void> {
  const root = reviewRoot(repoPath)
  const commentsDir = path.join(root, 'comments')
  await mkdir(commentsDir, { recursive: true })
  const gitignorePath = path.join(root, '.gitignore')
  try {
    await access(gitignorePath)
  } catch {
    await writeFile(gitignorePath, GITIGNORE_CONTENTS, 'utf8')
  }
}

export async function readConfig(repoPath: string): Promise<StoredConfig | null> {
  try {
    const raw = await readFile(configPath(repoPath), 'utf8')
    return storedConfigSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export function isConfigReady(config: StoredConfig | null): config is ReviewConfig {
  return Boolean(config?.baseBranch && config.reviewBranch)
}

export async function writeConfig(repoPath: string, config: ReviewConfig): Promise<ReviewConfig> {
  await ensureReviewDir(repoPath)
  const parsed = configSchema.parse(config)
  await writeFile(configPath(repoPath), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  return parsed
}

function emptyCommentsFile(branch: string, baseBranch: string): CommentsFile {
  return {
    version: 1,
    branch,
    baseBranch,
    updatedAt: new Date().toISOString(),
    comments: [],
  }
}

export async function readComments(
  repoPath: string,
  branch: string,
  baseBranch: string,
): Promise<CommentsFile> {
  await ensureReviewDir(repoPath)
  try {
    const raw = await readFile(commentsPath(repoPath, branch), 'utf8')
    return commentsFileSchema.parse(JSON.parse(raw))
  } catch {
    return emptyCommentsFile(branch, baseBranch)
  }
}

async function writeCommentsFile(repoPath: string, file: CommentsFile): Promise<CommentsFile> {
  await ensureReviewDir(repoPath)
  const parsed = commentsFileSchema.parse({
    ...file,
    updatedAt: new Date().toISOString(),
  })
  await writeFile(
    commentsPath(repoPath, parsed.branch),
    `${JSON.stringify(parsed, null, 2)}\n`,
    'utf8',
  )
  return parsed
}

function normalizeSnippet(snippet: string | undefined): string | undefined {
  if (snippet === undefined) return undefined
  if (snippet.trim() === '') return undefined
  return snippet
}

export async function addComment(
  repoPath: string,
  branch: string,
  baseBranch: string,
  input: unknown,
): Promise<CommentsFile> {
  const data = createCommentSchema.parse(input)
  const file = await readComments(repoPath, branch, baseBranch)

  let comment: Comment
  if (data.kind === 'line') {
    comment = {
      id: ulid(),
      kind: 'line',
      commitSha: data.commitSha,
      path: data.path,
      line: data.line,
      lineType: data.lineType,
      body: data.body,
      createdAt: new Date().toISOString(),
    }
    const snippet = normalizeSnippet(data.snippet)
    if (snippet !== undefined) {
      comment.snippet = snippet
    }
  } else if (data.kind === 'file') {
    comment = {
      id: ulid(),
      kind: 'file',
      commitSha: data.commitSha,
      path: data.path,
      body: data.body,
      createdAt: new Date().toISOString(),
    }
  } else {
    comment = {
      id: ulid(),
      kind: 'commit',
      commitSha: data.commitSha,
      body: data.body,
      createdAt: new Date().toISOString(),
    }
  }

  file.baseBranch = baseBranch
  file.branch = branch
  file.comments.push(comment)
  return writeCommentsFile(repoPath, file)
}

export async function updateComment(
  repoPath: string,
  branch: string,
  baseBranch: string,
  commentId: string,
  input: unknown,
): Promise<CommentsFile> {
  const data = updateCommentSchema.parse(input)
  const file = await readComments(repoPath, branch, baseBranch)
  const index = file.comments.findIndex((c) => c.id === commentId)
  if (index === -1) {
    throw Object.assign(new Error(`Comment not found: ${commentId}`), { status: 404 })
  }
  const existing = file.comments[index]!
  file.comments[index] = { ...existing, body: data.body }
  file.baseBranch = baseBranch
  file.branch = branch
  return writeCommentsFile(repoPath, file)
}

export async function deleteComment(
  repoPath: string,
  branch: string,
  baseBranch: string,
  commentId: string,
): Promise<CommentsFile> {
  const file = await readComments(repoPath, branch, baseBranch)
  file.comments = file.comments.filter((c) => c.id !== commentId)
  file.baseBranch = baseBranch
  file.branch = branch
  return writeCommentsFile(repoPath, file)
}
