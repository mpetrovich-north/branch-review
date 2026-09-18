import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import {
  assertGitRepo,
  branchExists,
  getCheckedOutBranch,
  getCommitDiff,
  GitError,
  listBranches,
  listCommitsNotInBase,
} from './git.js'
import {
  addComment,
  deleteComment,
  isConfigReady,
  readComments,
  readConfig,
  writeConfig,
} from './review-store.js'
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
    const checkedOutBranch = await getCheckedOutBranch(repoPath)
    res.json({ ok: true, repoPath, checkedOutBranch })
  }),
)

app.get(
  '/api/meta',
  asyncHandler(async (_req, res) => {
    await assertGitRepo(repoPath)
    const checkedOutBranch = await getCheckedOutBranch(repoPath)
    const config = await readConfig(repoPath)
    const branches = await listBranches(repoPath)
    res.json({
      repoPath,
      checkedOutBranch,
      config,
      branches,
      defaultBaseBranch: 'main',
      defaultReviewBranch: checkedOutBranch,
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
    if (!(await branchExists(repoPath, parsed.baseBranch))) {
      res.status(400).json({ error: `Base branch not found: ${parsed.baseBranch}` })
      return
    }
    if (!(await branchExists(repoPath, parsed.reviewBranch))) {
      res.status(400).json({ error: `Review branch not found: ${parsed.reviewBranch}` })
      return
    }
    if (parsed.baseBranch === parsed.reviewBranch) {
      res.status(400).json({ error: 'Review branch and base branch must differ' })
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
    if (!isConfigReady(config)) {
      res.status(400).json({ error: 'Set reviewBranch and baseBranch in config first' })
      return
    }
    const commits = await listCommitsNotInBase(
      repoPath,
      config.baseBranch,
      config.reviewBranch,
    )
    res.json({
      baseBranch: config.baseBranch,
      reviewBranch: config.reviewBranch,
      commits,
    })
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
    if (!isConfigReady(config)) {
      res.status(400).json({ error: 'Set reviewBranch and baseBranch in config first' })
      return
    }
    const file = await readComments(repoPath, config.reviewBranch, config.baseBranch)
    res.json(file)
  }),
)

app.post(
  '/api/comments',
  asyncHandler(async (req, res) => {
    const config = await readConfig(repoPath)
    if (!isConfigReady(config)) {
      res.status(400).json({ error: 'Set reviewBranch and baseBranch in config first' })
      return
    }
    const file = await addComment(repoPath, config.reviewBranch, config.baseBranch, req.body)
    res.status(201).json(file)
  }),
)

app.delete(
  '/api/comments/:id',
  asyncHandler(async (req, res) => {
    const config = await readConfig(repoPath)
    if (!isConfigReady(config)) {
      res.status(400).json({ error: 'Set reviewBranch and baseBranch in config first' })
      return
    }
    const file = await deleteComment(
      repoPath,
      config.reviewBranch,
      config.baseBranch,
      String(req.params.id),
    )
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
  const checkedOutBranch = await getCheckedOutBranch(repoPath)

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
    console.log(`checked out: ${checkedOutBranch ?? '(detached)'}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
