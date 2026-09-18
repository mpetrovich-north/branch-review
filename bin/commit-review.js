#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const repoPath = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd()
const port = process.env.PORT ?? '8787'

const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'server/index.ts'), repoPath],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: port,
      REPO_PATH: repoPath,
      NODE_ENV: process.env.NODE_ENV ?? 'production',
    },
  },
)

child.on('exit', (code) => process.exit(code ?? 0))
