# branch-review

Local GitHub-style UI to review commits on a branch one at a time and leave comments on a commit, a file, or a diff line. Comments are stored as JSON under `.branch-review/` in the target repository.

This app does not apply fixes. An agent skill (separate) can read `.branch-review/` and change code.

## Quick start

```bash
cd branch-review
npm install
npm run build
npm start
```

Open http://localhost:8787 and pick a **Repo** in the sidebar.

By default the app scans the **current directory** for git repos (the directory
itself, and its immediate child folders). Pass a path to scan somewhere else:

```bash
npx branch-review /path/to/projects
# or a single repo
npx branch-review /path/to/your/repo
```

You can also choose **Change directory…** in the Repo list. That choice is
remembered for later visits unless you start with a path argument.

Dev (Vite UI on :5173, API on :8787):

```bash
npm run dev
```

## Flow

1. Choose **Repo**, **review branch**, and **base branch** in the UI. Branch choices are saved to that repo’s `.branch-review/config.json`. The app does not check out the review branch.
2. Review commits on the review branch that are not on the base branch.
3. Comment on a commit, a file, or a diff line.
4. Comments are written to `.branch-review/comments/<branch-slug>.json` for the **review** branch.
5. Edit or delete a comment in the UI when it is done (agents may also delete after apply).

## On-disk layout

```text
.branch-review/
  .gitignore                 # ignores review data; no root .gitignore change
  config.json
  comments/<branch-slug>.json
```

Branch slug: `/` in the branch name becomes `--` (e.g. `feat/foo` → `feat--foo`).

See [docs/SCHEMA.md](docs/SCHEMA.md).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | API on `:8787` + Vite UI on `:5173` |
| `npm run build` | Build the UI into `dist/` |
| `npm start` | Serve API + built UI |

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | API/UI port (default `8787`) |
| `BRANCH_REVIEW_CWD` | Caller cwd used when no path argument is given (set by the `branch-review` bin) |

## Requirements

- Node 22+
- `git` on `PATH`
