#!/usr/bin/env node
/**
 * This script copies static files to the target directory and starts the server.
 * It is intended to be used as a replacement for `next start`.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

// Configuration for directories to copy
const DIRS_TO_COPY = [
  {
    src: path.join('.next', 'static'),
    dest: path.join('.next', 'standalone', '.next', 'static'),
  },
  {
    src: 'public',
    dest: path.join('.next', 'standalone', 'public'),
  },
]

// Path to the server script
const SERVER_SCRIPT_PATH = path.join('.next', 'standalone', 'server.js')

// Ensure target directory exists
const ensureDir = (dir) => {
  if (!existsSync(dir))
    mkdirSync(dir, { recursive: true })
}

// Function to recursively copy directories
const copyDir = (src, dest) => {
  try {
    cpSync(src, dest, { recursive: true })
    console.info(`Successfully copied ${src} to ${dest}`)
  }
  catch (err) {
    console.error(`Error copying ${src} to ${dest}:`, err.message)
    process.exit(1)
  }
}

// Process each directory copy operation
for (const { src, dest } of DIRS_TO_COPY) {
  ensureDir(dest)
  if (existsSync(src))
    copyDir(src, dest)
  else
    console.warn(`Warning: ${src} directory does not exist`)
}

// Start server
const port = process.env.npm_config_port || process.env.PORT || '3000'
const host = process.env.npm_config_host || process.env.HOSTNAME || 'localhost'

console.info(`Starting server on ${host}:${port}`)

const server = spawn(
  process.execPath,
  [SERVER_SCRIPT_PATH],
  {
    env: {
      ...process.env,
      PORT: port,
      HOSTNAME: host,
    },
    stdio: 'inherit',
  },
)

server.on('error', (err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})

server.on('exit', (code) => {
  process.exit(code || 0)
})
