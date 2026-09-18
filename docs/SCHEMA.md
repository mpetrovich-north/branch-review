# `.review/` schema (v1)

## `config.json`

```json
{
  "baseBranch": "main"
}
```

## `comments/<branch-slug>.json`

```json
{
  "version": 1,
  "branch": "feat/my-branch",
  "baseBranch": "main",
  "updatedAt": "2026-09-17T20:00:00.000Z",
  "comments": []
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

### Commit message comment

```json
{
  "id": "cmt_01HZY...",
  "kind": "commit_message",
  "commitSha": "abc1234def5678...",
  "body": "Subject should say why, not what.",
  "createdAt": "2026-09-17T20:02:00.000Z"
}
```

No `path`, `line`, `lineType`, or `snippet` on commit message comments.
