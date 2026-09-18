import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import {
  assertGitRepo,
  branchExists,
  detectDefaultBranch,
  getCheckedOutBranch,
  getCommitDiff,
  GitError,
  inferStackBaseBranch,
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
import {
  assertAllowedRepo,
  listRepos,
  parsePreferredRepo,
  parseRepoRoots,
} from './repos.js'
import { configSchema } from './schema.js'

const roots = parseRepoRoots()
const preferredRepo = parsePreferredRepo()
const port = Number(process.env.PORT ?? 8787)

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

function asyncHandler(
  fn: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next)
  }
}

async function resolveRepo(req: express.Request): Promise<string> {
  const raw = req.header('x-repo-path') ?? req.query.repo
  if (raw == null || String(raw).trim() === '') {
    throw Object.assign(new Error('X-Repo-Path header or repo query is required'), {
      status: 400,
    })
  }
  try {
    return await assertAllowedRepo(String(raw), roots, preferredRepo ? [preferredRepo] : [])
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      status: 400,
    })
  }
}

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      roots,
      preferredRepo,
    })
  }),
)

app.get(
  '/api/repos',
  asyncHandler(async (_req, res) => {
    const repos = await listRepos(roots)
    if (preferredRepo) {
      try {
        await assertGitRepo(preferredRepo)
        if (!repos.some((r) => r.path === preferredRepo)) {
          repos.unshift({
            path: preferredRepo,
            name: path.basename(preferredRepo),
          })
        }
      } catch {
        // preferred path is not a git repo; ignore
      }
    }
    res.json({ roots, preferredRepo, repos })
  }),
)

app.get(
  '/api/meta',
  asyncHandler(async (req, res) => {
    const repoPath = await resolveRepo(req)
    const checkedOutBranch = await getCheckedOutBranch(repoPath)
    const config = await readConfig(repoPath)
    const branches = await listBranches(repoPath)
    const defaultBaseBranch = await detectDefaultBranch(repoPath)
    const defaultReviewBranch = checkedOutBranch
    const suggestFor = config?.reviewBranch ?? defaultReviewBranch
    const suggestedBase = suggestFor
      ? await inferStackBaseBranch(repoPath, suggestFor)
      : null
    res.json({
      repoPath,
      checkedOutBranch,
      config,
      branches,
      defaultBaseBranch,
      defaultReviewBranch,
      suggestedBase,
    })
  }),
)

app.get(
  '/api/suggest-base',
  asyncHandler(async (req, res) => {
    const repoPath = await resolveRepo(req)
    const reviewBranch = String(req.query.reviewBranch ?? '').trim()
    if (!reviewBranch) {
      res.status(400).json({ error: 'reviewBranch query param is required' })
      return
    }
    if (!(await branchExists(repoPath, reviewBranch))) {
      res.status(400).json({ error: `Review branch not found: ${reviewBranch}` })
      return
    }
    const suggestedBase = await inferStackBaseBranch(repoPath, reviewBranch)
    res.json({ reviewBranch, suggestedBase })
  }),
)

app.get(
  '/api/config',
  asyncHandler(async (req, res) => {
    const repoPath = await resolveRepo(req)
    const config = await readConfig(repoPath)
    res.json({ config })
  }),
)

app.put(
  '/api/config',
  asyncHandler(async (req, res) => {
    const repoPath = await resolveRepo(req)
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
  asyncHandler(async (req, res) => {
    const repoPath = await resolveRepo(req)
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
    const repoPath = await resolveRepo(req)
    const sha = String(req.params.sha)
    const files = await getCommitDiff(repoPath, sha)
    res.json({ sha, files })
  }),
)

app.get(
  '/api/comments',
  asyncHandler(async (req, res) => {
    const repoPath = await resolveRepo(req)
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
    const repoPath = await resolveRepo(req)
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
    const repoPath = await resolveRepo(req)
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
    if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
      res.status(err.status).json({
        error: err instanceof Error ? err.message : 'Request error',
      })
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
  const isProd = process.env.NODE_ENV === 'production'
  if (isProd) {
    const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
    app.use(express.static(dist))
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'))
    })
  }

  app.listen(port, () => {
    console.log(`branch-review listening on http://localhost:${port}`)
    console.log(`roots: ${roots.join(', ')}`)
    if (preferredRepo) console.log(`preferred: ${preferredRepo}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
