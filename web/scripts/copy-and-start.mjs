#!/usr/bin/env node
/**
 * This script copies static files to the target directory and starts the server.
 * It is intended to be used as a replacement for `next start`.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'

// Create necessary directories
const staticDestDir = '.next/standalone/.next/static'
const publicDestDir = '.next/standalone/public'

// Ensure target directory exists
const ensureDir = (dir) => {
  if (!existsSync(dir))
    mkdirSync(dir, { recursive: true })
}

// Function to recursively copy directories
const copyDir = (src, dest) => {
  try {
    cpSync(src, dest, { recursive: true })
    console.log(`Successfully copied ${src} to ${dest}`)
  }
  catch (err) {
    console.error(`Error copying ${src} to ${dest}:`, err.message)
    process.exit(1)
  }
}

// Ensure target directories exist
ensureDir(staticDestDir)
ensureDir(publicDestDir)

// Copy static files
if (existsSync('.next/static'))
  copyDir('.next/static', staticDestDir)
else
  console.log('Warning: .next/static directory does not exist')

// Copy public resources
if (existsSync('public'))
  copyDir('public', publicDestDir)
else
  console.log('Warning: public directory does not exist')

// Start server
const port = process.env.npm_config_port || process.env.PORT || '3000'
const host = process.env.npm_config_host || process.env.HOSTNAME || 'localhost'

console.log(`Starting server on ${host}:${port}`)

const server = spawn(
  process.execPath,
  ['.next/standalone/server.js'],
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
