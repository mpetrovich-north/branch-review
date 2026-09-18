import { existsSync } from 'node:fs'
import { readdir, access } from 'node:fs/promises'
import path from 'node:path'
import { assertGitRepo } from './git.js'

export type RepoInfo = {
  path: string
  name: string
}

export function parsePreferredRepo(): string | null {
  const fromEnv = process.env.REPO_PATH
  const fromArg = process.argv.slice(2).find((a) => !a.startsWith('-'))
  const raw = fromArg ?? fromEnv
  return raw ? path.resolve(raw) : null
}

/** Directory used to infer the default scan root (caller cwd, not the app install dir). */
function inferenceCwd(): string {
  return path.resolve(
    process.env.BRANCH_REVIEW_CWD ?? process.env.INIT_CWD ?? process.cwd(),
  )
}

/** Parent of a repo, or inference cwd when that path is not itself a git work tree. */
export function defaultRepoRoot(): string {
  const preferred = parsePreferredRepo()
  if (preferred) return path.dirname(preferred)

  const cwd = inferenceCwd()
  if (existsSync(path.join(cwd, '.git'))) {
    return path.dirname(cwd)
  }
  return cwd
}

export function parseRepoRoots(): string[] {
  const fromEnv = process.env.REPO_ROOTS ?? process.env.REPO_ROOT
  if (fromEnv?.trim()) {
    return fromEnv
      .split(',')
      .map((s) => path.resolve(s.trim()))
      .filter(Boolean)
  }
  return [defaultRepoRoot()]
}

async function isGitWorkTree(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, '.git'))
    return true
  } catch {
    try {
      await assertGitRepo(dir)
      return true
    } catch {
      return false
    }
  }
}

export async function listRepos(roots: string[]): Promise<RepoInfo[]> {
  const found = new Map<string, RepoInfo>()

  for (const root of roots) {
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch {
      continue
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const full = path.join(root, name)
      if (!(await isGitWorkTree(full))) continue
      found.set(full, { path: full, name })
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function isPathInsideRoot(target: string, root: string): boolean {
  const resolvedTarget = path.resolve(target)
  const resolvedRoot = path.resolve(root)
  return (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(resolvedRoot + path.sep)
  )
}

export async function assertAllowedRepo(
  repoPath: string,
  roots: string[],
  extras: string[] = [],
): Promise<string> {
  const resolved = path.resolve(repoPath)
  const allowed =
    extras.some((e) => path.resolve(e) === resolved) ||
    roots.some((root) => isPathInsideRoot(resolved, root))
  if (!allowed) {
    throw new Error(`Repo path is not under an allowed root: ${resolved}`)
  }
  await assertGitRepo(resolved)
  return resolved
}
