# `.branch-review/` schema (v1)

## `config.json`

```json
{
  "baseBranch": "main",
  "reviewBranch": "feat/my-branch"
}
```

`reviewBranch` is the branch whose commits you inspect. The app reads that ref; it does not check out or change the branch on disk.

## `comments/<branch-slug>.json`

```json
{
  "version": 1,
  "branch": "feat/my-branch",
  "baseBranch": "main",
  "updatedAt": "2026-09-17T20:00:00.000Z",
  "comments": [],
  "messageEdits": {}
}
```

### Line comment

```json
{
  "id": "cmt_01HZX...",
  "kind": "line",
  "commitSha": "abc1234def5678...",
  "path": "src/foo.ts",
  "line": 42,
  "lineType": "added",
  "snippet": "  return items.reduce(...)",
  "body": "Prefer a plain for-loop here.",
  "createdAt": "2026-09-17T20:01:00.000Z"
}
```

`lineType` is `added` | `removed` | `unchanged`.

`snippet` is included when the line text is non-empty after trim; omitted for blank lines.

| `lineType` | `line` refers to |
| --- | --- |
| `added` | New file (post-image) |
| `unchanged` | New file (post-image) |
| `removed` | Old file (pre-image) |

### File comment

```json
{
  "id": "cmt_01HZZ...",
  "kind": "file",
  "commitSha": "abc1234def5678...",
  "path": "src/foo.ts",
  "body": "This file should not own this responsibility.",
  "createdAt": "2026-09-17T20:02:00.000Z"
}
```

No `line`, `lineType`, or `snippet` on file comments.

### Commit comment

```json
{
  "id": "cmt_01HZY...",
  "kind": "commit",
  "commitSha": "abc1234def5678...",
  "body": "Subject should say why, not what.",
  "createdAt": "2026-09-17T20:03:00.000Z"
}
```

No `path`, `line`, `lineType`, or `snippet` on commit comments.

### Message edits

Optional map of commit SHA → overlay for the subject and/or body. Missing keys use the git commit text. Does not rewrite git history.

```json
{
  "messageEdits": {
    "abc1234def5678...": {
      "subject": "feat(api): clarify filter error path",
      "body": "Keep the public error shape stable."
    }
  }
}
```

- Omit `subject` or `body` when that field is not overridden.
- An empty `body` string means the description is intentionally blank.
- Remove the SHA entry (or the field) to reset to git.
