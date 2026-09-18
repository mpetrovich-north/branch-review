# commit-review

Local GitHub-style UI to review commits on a branch one at a time and leave comments on lines or on the commit message. Comments are stored as JSON under `.review/` in the target repository.

This app does not apply fixes. An agent skill (separate) can read `.review/` and change code.

## Quick start

```bash
cd commit-review
npm install
REPO_PATH=/path/to/your/repo npm run dev
```

Open http://localhost:5173

Or pass the repo as an argument to the server:

```bash
REPO_PATH=/path/to/your/repo npm run dev
# equivalent server-only:
npx tsx server/index.ts /path/to/your/repo
```

## Flow

1. Set **review branch** and **base branch** in the UI (defaults: checked-out branch and `main`). Saved to `.review/config.json`. The app does not check out the review branch.
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
| `npm start` | Serve API + built UI (set `REPO_PATH`) |

## Requirements

- Node 22+
- `git` on `PATH`
- Target path must be a git work tree on a branch (not detached HEAD)
