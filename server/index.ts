import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import {
  assertGitRepo,
  branchExists,
  getCommitDiff,
  getCurrentBranch,
  GitError,
  listCommitsNotInBase,
  listLocalBranches,
} from './git.js'
import { addComment, deleteComment, readComments, readConfig, writeConfig } from './review-store.js'
import { configSchema } from './schema.js'

function parseRepoPath(): string {
  const fromEnv = process.env.REPO_PATH
  const fromArg = process.argv.slice(2).find((a) => !a.startsWith('-'))
  const repoPath = path.resolve(fromArg ?? fromEnv ?? process.cwd())
  return repoPath
}

const repoPath = parseRepoPath()
const port = Number(process.env.PORT ?? 8787)

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.use((_req, res, next) => {
  res.setHeader('X-Commit-Review-Repo', repoPath)
  next()
})

function asyncHandler(
  fn: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next)
  }
}

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    await assertGitRepo(repoPath)
    const branch = await getCurrentBranch(repoPath)
    res.json({ ok: true, repoPath, branch })
  }),
)

app.get(
  '/api/meta',
  asyncHandler(async (_req, res) => {
    await assertGitRepo(repoPath)
    const branch = await getCurrentBranch(repoPath)
    const config = await readConfig(repoPath)
    const branches = await listLocalBranches(repoPath)
    res.json({
      repoPath,
      branch,
      config,
      branches,
      defaultBaseBranch: 'main',
    })
  }),
)

app.get(
  '/api/config',
  asyncHandler(async (_req, res) => {
    const config = await readConfig(repoPath)
    res.json({ config })
  }),
)

app.put(
  '/api/config',
  asyncHandler(async (req, res) => {
    const parsed = configSchema.parse(req.body)
    const exists = await branchExists(repoPath, parsed.baseBranch)
    if (!exists) {
      res.status(400).json({ error: `Base branch not found: ${parsed.baseBranch}` })
      return
    }
    const config = await writeConfig(repoPath, parsed)
    res.json({ config })
  }),
)

app.get(
  '/api/commits',
  asyncHandler(async (_req, res) => {
    const config = await readConfig(repoPath)
    if (!config) {
      res.status(400).json({ error: 'Set baseBranch in config first' })
      return
    }
    const commits = await listCommitsNotInBase(repoPath, config.baseBranch)
    res.json({ baseBranch: config.baseBranch, commits })
  }),
)

app.get(
  '/api/commits/:sha/diff',
  asyncHandler(async (req, res) => {
    const sha = String(req.params.sha)
    const files = await getCommitDiff(repoPath, sha)
    res.json({ sha, files })
  }),
)

app.get(
  '/api/comments',
  asyncHandler(async (_req, res) => {
    const config = await readConfig(repoPath)
    if (!config) {
      res.status(400).json({ error: 'Set baseBranch in config first' })
      return
    }
    const branch = await getCurrentBranch(repoPath)
    const file = await readComments(repoPath, branch, config.baseBranch)
    res.json(file)
  }),
)

app.post(
  '/api/comments',
  asyncHandler(async (req, res) => {
    const config = await readConfig(repoPath)
    if (!config) {
      res.status(400).json({ error: 'Set baseBranch in config first' })
      return
    }
    const branch = await getCurrentBranch(repoPath)
    const file = await addComment(repoPath, branch, config.baseBranch, req.body)
    res.status(201).json(file)
  }),
)

app.delete(
  '/api/comments/:id',
  asyncHandler(async (req, res) => {
    const config = await readConfig(repoPath)
    if (!config) {
      res.status(400).json({ error: 'Set baseBranch in config first' })
      return
    }
    const branch = await getCurrentBranch(repoPath)
    const file = await deleteComment(repoPath, branch, config.baseBranch, String(req.params.id))
    res.json(file)
  }),
)

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof GitError) {
      res.status(400).json({ error: err.message, detail: err.stderr })
      return
    }
    if (err && typeof err === 'object' && 'name' in err && err.name === 'ZodError') {
      res.status(400).json({ error: 'Invalid request', detail: err })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  },
)

async function main() {
  await assertGitRepo(repoPath)
  const branch = await getCurrentBranch(repoPath)

  const isProd = process.env.NODE_ENV === 'production'
  if (isProd) {
    const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
    app.use(express.static(dist))
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'))
    })
  }

  app.listen(port, () => {
    console.log(`commit-review listening on http://localhost:${port}`)
    console.log(`repo: ${repoPath}`)
    console.log(`branch: ${branch}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
