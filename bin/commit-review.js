#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const preferred = process.argv[2] ? path.resolve(process.argv[2]) : undefined
const port = process.env.PORT ?? '8787'
const repoRoot = process.env.REPO_ROOT ?? path.join(homedir(), 'Code')

const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'server/index.ts')],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: port,
      REPO_ROOT: process.env.REPO_ROOT ?? repoRoot,
      ...(preferred ? { REPO_PATH: preferred } : {}),
      NODE_ENV: process.env.NODE_ENV ?? 'production',
    },
  },
)

child.on('exit', (code) => process.exit(code ?? 0))
