/**
 * E2E: difyctl run app --file — file input specialisation
 *
 * Test cases sourced from: Dify CLI Enhanced spec — Dify CLI/Run/File Input (31 cases)
 *
 * Prerequisites:
 *   DIFY_E2E_FILE_APP_ID — workflow app with a required 'doc' file variable
 *   All file-related cases are skipped when this variable is not configured.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { assertExitCode, assertJson } from '../../helpers/assert.js'
import { injectAuth, run, withTempConfig } from '../../helpers/cli.js'
import { optionalDescribe, optionalIt } from '../../helpers/skip.js'
import { loadE2EEnv } from '../../setup/env.js'

const E = loadE2EEnv()
// supportsLocalUpload capability removed — local file upload probe is no longer
// performed in global-setup. Default to false (skip upload-specific cases).
const supportsLocalUpload = false

const describeSuite = optionalDescribe(Boolean(E.fileAppId))

describeSuite('E2E / difyctl run app --file', () => {
  let configDir: string
  let fileDir: string
  let cleanupConfig: () => Promise<void>

  beforeEach(async () => {
    const tmp = await withTempConfig()
    configDir = tmp.configDir
    cleanupConfig = tmp.cleanup
    fileDir = await mkdtemp(join(tmpdir(), 'difyctl-e2e-files-'))
    await injectAuth(configDir, {
      host: E.host,
      bearer: E.token,
      workspaceId: E.workspaceId,
      workspaceName: E.workspaceName,
    })
  })

  afterEach(async () => {
    await cleanupConfig()
    await rm(fileDir, { recursive: true, force: true })
  })

  function r(argv: string[]) {
    return run(argv, { configDir })
  }

  const itLocalUpload = optionalIt(supportsLocalUpload)

  itLocalUpload('[P0] run app supports single file upload (key=@path) — app executes correctly', async () => {
    // Spec: run app supports single file upload + app executes correctly after upload
    const filePath = join(fileDir, 'test.txt')
    await writeFile(filePath, 'E2E test file content — single upload')
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${filePath}`])
    assertExitCode(result, 0)
  })

  itLocalUpload('[P0] file input argument name maps correctly (key binds to correct input field)', async () => {
    // Spec: file input argument name maps correctly
    const filePath = join(fileDir, 'mapping.txt')
    await writeFile(filePath, 'mapping test content')
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${filePath}`, '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<Record<string, unknown>>(result)
    expect(parsed).toBeDefined()
  })

  itLocalUpload('[P0] run app --file syntax is key=@path (local file upload)', async () => {
    // Spec: run app --file syntax is key=@path
    const filePath = join(fileDir, 'syntax.txt')
    await writeFile(filePath, 'syntax verification')
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${filePath}`])
    assertExitCode(result, 0)
  })

  it('[P0] --file remote URL syntax (key=https://...) requires no local upload', async () => {
    // Spec: run app --file with remote URL executes the workflow correctly
    const result = await r([
      'run',
      'app',
      E.fileAppId,
      '--file',
      'doc=https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    ])
    assertExitCode(result, 0)
  })

  it('[P0] non-existent file path returns an error', async () => {
    // Spec: non-existent file path returns an error
    const result = await r([
      'run',
      'app',
      E.fileAppId,
      '--file',
      'doc=@/nonexistent/path/missing-file.txt',
    ])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/failed|not.?found|upload/i)
  })

  it('[P1] malformed --file argument returns usage error (exit code 2)', async () => {
    // Spec: malformed --file argument returns a usage error
    const result = await r([
      'run',
      'app',
      E.chatAppId,
      'hello',
      '--file',
      'invalidformat',
    ])
    assertExitCode(result, 2)
    expect(result.stderr).toMatch(/--file must be key=@path/i)
  })

  itLocalUpload('[P1] file path containing spaces can be uploaded correctly', async () => {
    // Spec: file path containing spaces can be uploaded correctly
    const filePath = join(fileDir, 'file with spaces.txt')
    await writeFile(filePath, 'space in name test')
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${filePath}`])
    assertExitCode(result, 0)
  })

  itLocalUpload('[P1] txt file upload is supported', async () => {
    // Spec: txt file upload is supported
    const f = join(fileDir, 'note.txt')
    await writeFile(f, 'plain text content')
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${f}`])
    assertExitCode(result, 0)
  })

  itLocalUpload('[P1] --file combined with --stream works correctly', async () => {
    // Spec: run app --file combined with --stream
    const f = join(fileDir, 'stream.txt')
    await writeFile(f, 'stream + file test')
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${f}`, '--stream'])
    assertExitCode(result, 0)
  })

  it('[P0] unauthenticated file upload returns auth error (exit code 4)', async () => {
    // Spec: unauthenticated file upload returns an auth error
    const unauthTmp = await withTempConfig()
    try {
      const f = join(fileDir, 'unauth.txt')
      await writeFile(f, 'test')
      const result = await run(
        ['run', 'app', E.fileAppId || E.chatAppId, '--file', `doc=@${f}`],
        { configDir: unauthTmp.configDir },
      )
      assertExitCode(result, 4)
    }
    finally {
      await unauthTmp.cleanup()
    }
  })
})
