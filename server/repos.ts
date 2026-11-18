import { access, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { assertGitRepo, resolveGitToplevel } from './git.js'

export type RepoInfo = {
  path: string
  name: string
}

/** Caller cwd when launched via the bin (not the app install dir). */
function inferenceCwd(): string {
  return path.resolve(
    process.env.BRANCH_REVIEW_CWD ?? process.env.INIT_CWD ?? process.cwd(),
  )
}

/** Optional directory argument, else the inference cwd. */
export function parseScanRoot(): { root: string; fromCli: boolean } {
  const fromArg = process.argv.slice(2).find((a) => !a.startsWith('-'))
  if (fromArg) {
    return { root: path.resolve(fromArg), fromCli: true }
  }
  return { root: inferenceCwd(), fromCli: false }
}

function badScanRoot(message: string): Error {
  return Object.assign(new Error(message), { status: 400 })
}

export async function assertScanRoot(dir: string): Promise<string> {
  const resolved = path.resolve(dir)
  let info
  try {
    info = await stat(resolved)
  } catch {
    throw badScanRoot(`Directory does not exist: ${resolved}`)
  }
  if (!info.isDirectory()) {
    throw badScanRoot(`Not a directory: ${resolved}`)
  }
  return resolved
}

/**
 * True only when `dir` itself is a git work tree root (has a `.git` file or
 * directory). Do not use `git rev-parse --is-inside-work-tree`: that is true for
 * every subdirectory of a repo, which made nested folders like `design/` and
 * `src/` show up as separate repos and steal the alphabetical default.
 */
async function isGitWorkTree(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

/** Find git repos at the scan root itself and in its immediate child folders. */
export async function listRepos(roots: string[]): Promise<RepoInfo[]> {
  const found = new Map<string, RepoInfo>()

  for (const root of roots) {
    if (await isGitWorkTree(root)) {
      found.set(root, { path: root, name: path.basename(root) })
    }

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

export async function assertAllowedRepo(repoPath: string, roots: string[]): Promise<string> {
  const resolved = path.resolve(repoPath)
  const allowed = roots.some((root) => isPathInsideRoot(resolved, root))
  if (!allowed) {
    throw new Error(`Repo path is not under an allowed root: ${resolved}`)
  }
  await assertGitRepo(resolved)
  // Map nested paths (and stale localStorage entries) to the real work tree root
  // so comments land in `<repo>/.branch-review/`, not a child folder.
  const toplevel = path.resolve(await resolveGitToplevel(resolved))
  const toplevelAllowed = roots.some((root) => isPathInsideRoot(toplevel, root))
  if (!toplevelAllowed) {
    throw new Error(`Repo path is not under an allowed root: ${toplevel}`)
  }
  return toplevel
}
