import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { ENV_CONFIG_DIR } from '../../src/store/dir.js'

// Points ENV_CONFIG_DIR at a fresh temp dir per test and restores it after.
// Call inside a describe block; returns a getter because the dir changes per test.
export function useTempConfigDir(prefix: string): () => string {
  let dir = ''
  let prev: string | undefined
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), prefix))
    prev = process.env[ENV_CONFIG_DIR]
    process.env[ENV_CONFIG_DIR] = dir
  })
  afterEach(async () => {
    if (prev === undefined) delete process.env[ENV_CONFIG_DIR]
    else process.env[ENV_CONFIG_DIR] = prev
    await rm(dir, { recursive: true, force: true })
  })
  return () => dir
}
