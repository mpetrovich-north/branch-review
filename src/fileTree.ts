import type { DiffFile } from './types'

export type FileTreeFileNode = {
  kind: 'file'
  name: string
  path: string
  file: DiffFile
  /** Index in the flat diff file list (for stable ordering). */
  order: number
}

export type FileTreeDirNode = {
  kind: 'dir'
  name: string
  path: string
  children: FileTreeNode[]
  /** Earliest file index under this directory. */
  order: number
}

export type FileTreeNode = FileTreeDirNode | FileTreeFileNode

type MutableDir = {
  kind: 'dir'
  name: string
  path: string
  dirs: Map<string, MutableDir>
  files: Map<string, FileTreeFileNode>
  order: number
}

function createDir(name: string, path: string, order: number): MutableDir {
  return { kind: 'dir', name, path, dirs: new Map(), files: new Map(), order }
}

function compareByOrder(a: FileTreeNode, b: FileTreeNode): number {
  return a.order - b.order
}

function finalize(dir: MutableDir): FileTreeDirNode {
  const children: FileTreeNode[] = [
    ...[...dir.dirs.values()].map(finalize),
    ...dir.files.values(),
  ].sort(compareByOrder)
  return {
    kind: 'dir',
    name: dir.name,
    path: dir.path,
    children,
    order: dir.order,
  }
}

export function buildFileTree(files: DiffFile[]): FileTreeNode[] {
  const root = createDir('', '', Number.POSITIVE_INFINITY)

  files.forEach((file, index) => {
    const parts = file.path.split('/').filter(Boolean)
    if (parts.length === 0) return

    let dir = root
    dir.order = Math.min(dir.order, index)
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i]!
      const nextPath = parts.slice(0, i + 1).join('/')
      let next = dir.dirs.get(segment)
      if (!next) {
        next = createDir(segment, nextPath, index)
        dir.dirs.set(segment, next)
      } else {
        next.order = Math.min(next.order, index)
      }
      dir = next
    }

    const name = parts[parts.length - 1]!
    dir.files.set(name, {
      kind: 'file',
      name,
      path: file.path,
      file,
      order: index,
    })
  })

  return finalize(root).children
}

export function collectDirPaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = []
  const walk = (list: FileTreeNode[]) => {
    for (const node of list) {
      if (node.kind === 'dir') {
        paths.push(node.path)
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return paths
}
