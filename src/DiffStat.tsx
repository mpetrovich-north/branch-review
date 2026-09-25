import type { DiffFile, DiffStatCounts } from './types'

export type { DiffStatCounts }

export function countFileDiffStats(file: DiffFile): DiffStatCounts {
  let added = 0
  let removed = 0
  for (const line of file.lines) {
    if (line.type === 'added') added += 1
    else if (line.type === 'removed') removed += 1
  }
  return { added, removed }
}

export function sumDiffStats(files: DiffFile[]): DiffStatCounts {
  let added = 0
  let removed = 0
  for (const file of files) {
    const stats = countFileDiffStats(file)
    added += stats.added
    removed += stats.removed
  }
  return { added, removed }
}

function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function DiffStat({
  added,
  removed,
  className,
}: DiffStatCounts & { className?: string }) {
  return (
    <span
      className={className ? `diff-stat ${className}` : 'diff-stat'}
      aria-label={`${formatCount(added)} added, ${formatCount(removed)} removed`}
    >
      <span className="diff-stat-added">+{formatCount(added)}</span>
      <span className="diff-stat-removed">−{formatCount(removed)}</span>
    </span>
  )
}
