import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export class GitError extends Error {
  readonly stderr?: string

  constructor(message: string, stderr?: string) {
    super(message)
    this.name = 'GitError'
    this.stderr = stderr
  }
}

async function git(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8',
    })
    return stdout
  } catch (error) {
    const err = error as { stderr?: string; message?: string }
    throw new GitError(err.message ?? 'git command failed', err.stderr)
  }
}

export async function assertGitRepo(repoPath: string): Promise<void> {
  const out = await git(repoPath, ['rev-parse', '--is-inside-work-tree'])
  if (out.trim() !== 'true') {
    throw new GitError('Not a git repository')
  }
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const out = await git(repoPath, ['branch', '--show-current'])
  const branch = out.trim()
  if (!branch) {
    throw new GitError('Detached HEAD is not supported; check out a branch')
  }
  return branch
}

export async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    try {
      await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])
      return true
    } catch {
      return false
    }
  }
}

export function resolveBaseRef(baseBranch: string): string {
  return baseBranch
}

async function resolveCommitish(repoPath: string, name: string): Promise<string> {
  try {
    return (await git(repoPath, ['rev-parse', '--verify', name])).trim()
  } catch {
    return (await git(repoPath, ['rev-parse', '--verify', `origin/${name}`])).trim()
  }
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

export async function listCommitsNotInBase(
  repoPath: string,
  baseBranch: string,
): Promise<CommitSummary[]> {
  await resolveCommitish(repoPath, baseBranch)
  const range = `${baseBranch}..HEAD`
  const format = ['%H', '%h', '%s', '%b', '%an', '%ae', '%aI'].join('%x1f') + '%x1e'
  let stdout: string
  try {
    stdout = await git(repoPath, [
      'log',
      '--reverse',
      `--format=${format}`,
      range,
    ])
  } catch {
    stdout = await git(repoPath, [
      'log',
      '--reverse',
      `--format=${format}`,
      `origin/${baseBranch}..HEAD`,
    ])
  }

  const records = stdout.split('\x1e').map((r) => r.trim()).filter(Boolean)
  return records.map((record) => {
    const [sha, shortSha, subject, body, authorName, authorEmail, authoredAt] =
      record.split('\x1f')
    return {
      sha,
      shortSha,
      subject,
      body: (body ?? '').replace(/\n+$/, ''),
      authorName,
      authorEmail,
      authoredAt,
    }
  })
}

export type DiffLineType = 'added' | 'removed' | 'unchanged' | 'meta'

export type DiffLine = {
  type: DiffLineType
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

export async function getCommitDiff(repoPath: string, sha: string): Promise<DiffFile[]> {
  const stdout = await git(repoPath, [
    'show',
    '--format=',
    '--unified=3',
    '--find-renames',
    sha,
  ])
  return parseUnifiedDiff(stdout)
}

export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = []
  const chunks = diffText.split(/^diff --git /m).filter(Boolean)

  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    const header = lines[0] ?? ''
    const match = /^a\/(.+) b\/(.+)$/.exec(header)
    if (!match) continue

    let oldPath = match[1]
    let newPath = match[2]
    let status: DiffFile['status'] = 'modified'

    for (const line of lines) {
      if (line.startsWith('new file mode')) status = 'added'
      if (line.startsWith('deleted file mode')) status = 'deleted'
      if (line.startsWith('rename from ')) {
        status = 'renamed'
        oldPath = line.slice('rename from '.length)
      }
      if (line.startsWith('rename to ')) {
        newPath = line.slice('rename to '.length)
      }
    }

    const path = status === 'deleted' ? oldPath : newPath
    const fileLines: DiffLine[] = []
    let oldLine = 0
    let newLine = 0

    for (const line of lines) {
      if (line.startsWith('@@')) {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line)
        if (!hunk) continue
        oldLine = Number(hunk[1])
        newLine = Number(hunk[2])
        fileLines.push({
          type: 'meta',
          content: line,
          oldLine: null,
          newLine: null,
        })
        continue
      }

      if (
        line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('old mode') ||
        line.startsWith('new mode') ||
        line.startsWith('deleted file mode') ||
        line.startsWith('new file mode') ||
        line.startsWith('similarity index') ||
        line.startsWith('rename from') ||
        line.startsWith('rename to')
      ) {
        continue
      }

      if (line.startsWith('+')) {
        fileLines.push({
          type: 'added',
          content: line.slice(1),
          oldLine: null,
          newLine: newLine,
        })
        newLine += 1
      } else if (line.startsWith('-')) {
        fileLines.push({
          type: 'removed',
          content: line.slice(1),
          oldLine: oldLine,
          newLine: null,
        })
        oldLine += 1
      } else if (line.startsWith('\\')) {
        fileLines.push({
          type: 'meta',
          content: line,
          oldLine: null,
          newLine: null,
        })
      } else if (line.startsWith(' ') || line === '') {
        const content = line.startsWith(' ') ? line.slice(1) : line
        fileLines.push({
          type: 'unchanged',
          content,
          oldLine: oldLine,
          newLine: newLine,
        })
        oldLine += 1
        newLine += 1
      }
    }

    files.push({
      path,
      oldPath: oldPath === newPath ? null : oldPath,
      status,
      lines: fileLines,
    })
  }

  return files
}

export async function listLocalBranches(repoPath: string): Promise<string[]> {
  const stdout = await git(repoPath, ['branch', '--format=%(refname:short)'])
  return stdout
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean)
}
