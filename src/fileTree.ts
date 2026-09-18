import type { DiffFile } from './types'

export type FileTreeFileNode = {
  kind: 'file'
  name: string
  path: string
  file: DiffFile
}

export type FileTreeDirNode = {
  kind: 'dir'
  name: string
  path: string
  children: FileTreeNode[]
}

export type FileTreeNode = FileTreeDirNode | FileTreeFileNode

type MutableDir = {
  kind: 'dir'
  name: string
  path: string
  dirs: Map<string, MutableDir>
  files: Map<string, FileTreeFileNode>
}

function createDir(name: string, path: string): MutableDir {
  return { kind: 'dir', name, path, dirs: new Map(), files: new Map() }
}

function compareNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name)
}

function finalize(dir: MutableDir): FileTreeDirNode {
  const children: FileTreeNode[] = [
    ...[...dir.dirs.values()].map(finalize),
    ...dir.files.values(),
  ].sort(compareNodes)
  return collapseSingleChildDirs({
    kind: 'dir',
    name: dir.name,
    path: dir.path,
    children,
  })
}

/** Fold `a/ → b/ → c/` into `a/b/c/` when each level has one directory child. */
function collapseSingleChildDirs(node: FileTreeDirNode): FileTreeDirNode {
  let current = node
  while (
    current.children.length === 1 &&
    current.children[0]!.kind === 'dir' &&
    current.name !== ''
  ) {
    const only = current.children[0] as FileTreeDirNode
    current = {
      kind: 'dir',
      name: `${current.name}/${only.name}`,
      path: only.path,
      children: only.children,
    }
  }
  return {
    ...current,
    children: current.children.map((child) =>
      child.kind === 'dir' ? collapseSingleChildDirs(child) : child,
    ),
  }
}

export function buildFileTree(files: DiffFile[]): FileTreeNode[] {
  const root = createDir('', '')

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    if (parts.length === 0) continue

    let dir = root
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i]!
      const nextPath = parts.slice(0, i + 1).join('/')
      let next = dir.dirs.get(segment)
      if (!next) {
        next = createDir(segment, nextPath)
        dir.dirs.set(segment, next)
      }
      dir = next
    }

    const name = parts[parts.length - 1]!
    dir.files.set(name, { kind: 'file', name, path: file.path, file })
  }

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
