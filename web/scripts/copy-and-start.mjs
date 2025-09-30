#!/usr/bin/env node
/**
 * This script copies static files to the target directory and starts the server.
 * It is intended to be used as a replacement for `next start`.
 */

import { cp, mkdir, stat } from 'node:fs/promises'
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

// Function to check if a path exists
const pathExists = async (path) => {
  try {
    console.debug(`Checking if path exists: ${path}`)
    await stat(path)
    console.debug(`Path exists: ${path}`)
    return true
  }
  catch {
    console.warn(`Path does not exist: ${path}`)
    return false
  }
}

// Function to recursively copy directories
const copyDir = async (src, dest) => {
  try {
    console.debug(`Copying directory from ${src} to ${dest}`)
    await cp(src, dest, { recursive: true })
    console.info(`Successfully copied ${src} to ${dest}`)
  }
  catch (err) {
    console.error(`Error copying ${src} to ${dest}:`, err.message)
    process.exit(1)
  }
}

// Process each directory copy operation
const copyAllDirs = async () => {
  console.debug('Starting directory copy operations')
  for (const { src, dest } of DIRS_TO_COPY) {
    try {
      console.debug(`Ensuring destination directory exists: ${dest}`)
      await mkdir(dest, { recursive: true })
      if (await pathExists(src))
        await copyDir(src, dest)
      else
        console.warn(`Warning: ${src} directory does not exist`)
    }
    catch (err) {
      console.error(`Error processing ${src}:`, err.message)
      process.exit(1)
    }
  }
  console.debug('Finished directory copy operations')
}

// Run copy operations and start server
const main = async () => {
  console.debug('Starting copy-and-start script')
  await copyAllDirs()

  // Start server
  const port = process.env.npm_config_port || process.env.PORT || '3000'
  const host = process.env.npm_config_host || process.env.HOSTNAME || 'localhost'

  console.info(`Starting server on ${host}:${port}`)
  console.debug(`Server script path: ${SERVER_SCRIPT_PATH}`)
  console.debug(`Environment variables - PORT: ${port}, HOSTNAME: ${host}`)

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
    console.debug(`Server exited with code: ${code}`)
    process.exit(code || 0)
  })
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
