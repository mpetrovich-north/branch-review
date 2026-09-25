import type { DiffLine } from './types'

const SHOW_WHITESPACE_KEY = 'branch-review.showWhitespace'

/** Default on: show whitespace changes (GitHub default). */
export function readStoredShowWhitespace(): boolean {
  try {
    const value = localStorage.getItem(SHOW_WHITESPACE_KEY)
    if (value === null) return true
    return value !== '0'
  } catch {
    return true
  }
}

export function writeStoredShowWhitespace(show: boolean): void {
  try {
    localStorage.setItem(SHOW_WHITESPACE_KEY, show ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function normalizeWhitespace(content: string): string {
  return content.replace(/\s+/g, '')
}

/**
 * For added/removed pairs that differ only in whitespace: drop the removed
 * line and keep the added line as unchanged context (GitHub ?w=1 style on an
 * existing unified diff).
 */
export function hideWhitespaceOnlyChanges(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type !== 'added' && line.type !== 'removed') {
      out.push(line)
      i += 1
      continue
    }

    const blockStart = i
    while (i < lines.length && (lines[i].type === 'added' || lines[i].type === 'removed')) {
      i += 1
    }
    out.push(...filterChangeBlock(lines.slice(blockStart, i)))
  }
  return out
}

function filterChangeBlock(block: DiffLine[]): DiffLine[] {
  const removedIdx: number[] = []
  const addedIdx: number[] = []
  for (let i = 0; i < block.length; i++) {
    if (block[i].type === 'removed') removedIdx.push(i)
    else addedIdx.push(i)
  }

  const addedToRemoved = new Map<number, number>()
  const usedAdded = new Set<number>()
  const dropRemoved = new Set<number>()

  for (const ri of removedIdx) {
    const needle = normalizeWhitespace(block[ri].content)
    for (const ai of addedIdx) {
      if (usedAdded.has(ai)) continue
      if (normalizeWhitespace(block[ai].content) === needle) {
        addedToRemoved.set(ai, ri)
        usedAdded.add(ai)
        dropRemoved.add(ri)
        break
      }
    }
  }

  const out: DiffLine[] = []
  for (let i = 0; i < block.length; i++) {
    if (dropRemoved.has(i)) continue
    const line = block[i]
    if (line.type === 'added' && addedToRemoved.has(i)) {
      const removed = block[addedToRemoved.get(i)!]
      out.push({
        type: 'unchanged',
        content: line.content,
        oldLine: removed.oldLine,
        newLine: line.newLine,
      })
      continue
    }
    out.push(line)
  }

  return out
}
