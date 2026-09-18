# commit-review

Local GitHub-style UI to review commits on a branch one at a time and leave comments on lines or on the commit message. Comments are stored as JSON under `.review/` in the target repository.

This app does not apply fixes. An agent skill (separate) can read `.review/` and change code.

## Quick start

```bash
cd commit-review
npm install
npm run build
npm start
```

Open http://localhost:8787 and pick a **Repo** in the header.

By default the app scans the **current directory**, or the **parent of the
current/preferred git repo** (so sibling clones appear). Override with
`REPO_ROOT` / `REPO_ROOTS` when needed.

Optional:

```bash
# Prefer a repo on first load (still switchable in the UI)
REPO_PATH=/path/to/your/repo npm start

# Explicit scan folder
REPO_ROOT=/path/to/projects npm start

# Dev (Vite UI on :5173, API on :8787)
npm run dev
```

## Flow

1. Choose **Repo**, **review branch**, and **base branch** in the UI. Branch choices are saved to that repo’s `.review/config.json`. The app does not check out the review branch.
2. Review commits on the review branch that are not on the base branch.
3. Comment on a commit message or on a diff line.
4. Comments are written to `.review/comments/<branch-slug>.json` for the **review** branch.
5. Delete a comment in the UI when it is done (agents may also delete after apply).

## On-disk layout

```text
.review/
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
| `REPO_ROOT` / `REPO_ROOTS` | Folder(s) to scan for git repos (default: cwd, or parent of cwd/preferred repo; comma-separated for several) |
| `REPO_PATH` | Optional preferred repo for first load |
| `PORT` | API/UI port (default `8787`) |

## Requirements

- Node 22+
- `git` on `PATH`
