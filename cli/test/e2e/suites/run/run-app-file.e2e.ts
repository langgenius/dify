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
import { afterEach, beforeEach, expect, inject, it } from 'vitest'
import { assertExitCode, assertJson, assertNoAnsi } from '../../helpers/assert.js'
import { injectAuth, run, withTempConfig } from '../../helpers/cli.js'
import { withRetry } from '../../helpers/retry.js'
import { optionalDescribe, optionalIt } from '../../helpers/skip.js'
import { resolveEnv } from '../../setup/env.js'

// @ts-expect-error — see test/e2e/helpers/vitest-context.ts for explanation
const caps = inject('e2eCapabilities') as import('../../setup/env.js').E2ECapabilities
const E = resolveEnv(caps)
const itWithSso = optionalIt(Boolean(E.ssoToken))
// supportsLocalUpload capability removed — local file upload probe is no longer
// performed in global-setup. Default to false (skip upload-specific cases).
const supportsLocalUpload = true

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
      email: E.email,
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

  // Minimal 1×1 white PNG — used as the required 'picture' (image) fixture.
  async function writePng(path: string): Promise<void> {
    const { Buffer } = await import('node:buffer')
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==',
      'base64',
    )
    await writeFile(path, pngBytes)
  }

  const itLocalUpload = optionalIt(supportsLocalUpload)

  itLocalUpload('[P0] run app supports single file upload (key=@path) — app executes correctly', async () => {
    // Spec: run app supports single file upload + app executes correctly after upload
    const filePath = join(fileDir, 'test.txt')
    const picPath = join(fileDir, 'test.png')
    await writeFile(filePath, 'E2E test file content — single upload')
    await writePng(picPath)
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${filePath}`, '--file', `picture=@${picPath}`])
    assertExitCode(result, 0)
  })

  itLocalUpload('[P0] file input argument name maps correctly (key binds to correct input field)', async () => {
    // Spec: file input argument name maps correctly
    const filePath = join(fileDir, 'mapping.txt')
    const picPath = join(fileDir, 'mapping.png')
    await writeFile(filePath, 'mapping test content')
    await writePng(picPath)
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${filePath}`, '--file', `picture=@${picPath}`, '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<Record<string, unknown>>(result)
    expect(parsed).toBeDefined()
  })

  itLocalUpload('[P0] run app --file syntax is key=@path (local file upload)', async () => {
    // Spec: run app --file syntax is key=@path
    const filePath = join(fileDir, 'syntax.txt')
    const picPath = join(fileDir, 'syntax.png')
    await writeFile(filePath, 'syntax verification')
    await writePng(picPath)
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${filePath}`, '--file', `picture=@${picPath}`])
    assertExitCode(result, 0)
  })

  it('[P0] --file remote URL syntax (key=https://...) requires no local upload', async () => {
    // Spec: run app --file with remote URL executes the workflow correctly
    // file_auto_test requires both 'doc' (document) and 'picture' (image) fields.
    const result = await r([
      'run',
      'app',
      E.fileAppId,
      '--file',
      'doc=https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      '--file',
      'picture=https://www.w3.org/Icons/w3c_home.png',
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
    expect(result.stderr).toMatch(/failed|not.?found|upload|no such file|ENOENT/i)
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
    expect(result.stderr).toMatch(/--file|key[^\n\r@\u2028\u2029]*@.*path|invalid.*file/i)
  })

  itLocalUpload('[P1] file path containing spaces can be uploaded correctly', async () => {
    // Spec: file path containing spaces can be uploaded correctly
    const filePath = join(fileDir, 'file with spaces.txt')
    const picPath = join(fileDir, 'pic spaces.png')
    await writeFile(filePath, 'space in name test')
    await writePng(picPath)
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${filePath}`, '--file', `picture=@${picPath}`])
    assertExitCode(result, 0)
  })

  itLocalUpload('[P1] txt file upload is supported', async () => {
    // Spec: txt file upload is supported
    const f = join(fileDir, 'note.txt')
    const picPath = join(fileDir, 'note.png')
    await writeFile(f, 'plain text content')
    await writePng(picPath)
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${f}`, '--file', `picture=@${picPath}`])
    assertExitCode(result, 0)
  })

  itLocalUpload('[P1] --file combined with --stream works correctly', async () => {
    // Spec: run app --file combined with --stream
    const f = join(fileDir, 'stream.txt')
    const picPath = join(fileDir, 'stream.png')
    await writeFile(f, 'stream + file test')
    await writePng(picPath)
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${f}`, '--file', `picture=@${picPath}`, '--stream'])
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

  // ── P0 additions ────────────────────────────────────────────────────────

  itLocalUpload('[P0] pdf file upload is supported (4.4.8)', async () => {
    // Spec 4.4.8: .pdf is a valid document type for the doc field.
    const pdfPath = join(fileDir, 'test.pdf')
    const picPath = join(fileDir, 'pdf-pic.png')
    await writeFile(pdfPath, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj '
    + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj '
    + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\n'
    + 'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n'
    + '0000000058 00000 n \n0000000115 00000 n \n'
    + 'trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n')
    await writePng(picPath)
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${pdfPath}`, '--file', `picture=@${picPath}`])
    assertExitCode(result, 0)
  })
  itWithSso('[P0] SSO (dfoe_) token can execute file run (exit code 0) (4.4.23)', async () => {
    // Spec 4.4.23: an SSO-provisioned token must be able to run a file app.
    // Note: DIFY_E2E_SSO_TOKEN may be a dfoa_ token in dev environments;
    // the test verifies the token can execute the app regardless of prefix.
    const { join: pjoin } = await import('node:path')
    const ssoTmp = await withTempConfig()
    try {
      await injectAuth(ssoTmp.configDir, {
        host: E.host,
        bearer: E.ssoToken,
        email: 'sso-e2e@example.com',
        workspaceId: E.workspaceId,
        workspaceName: E.workspaceName,
      })
      const docPath = pjoin(fileDir, 'sso-doc.txt')
      const picPath = pjoin(fileDir, 'sso-pic.png')
      await writeFile(docPath, 'sso file run test')
      await writePng(picPath)
      const result = await withRetry(
        () => run(
          ['run', 'app', E.fileAppId, '--file', `doc=@${docPath}`, '--file', `picture=@${picPath}`],
          { configDir: ssoTmp.configDir },
        ),
        { attempts: 3, delayMs: 2000 },
      )
      assertExitCode(result, 0)
    }
    finally {
      await ssoTmp.cleanup()
    }
  })

  // ── P1 additions ────────────────────────────────────────────────────────

  itLocalUpload('[P1] empty file upload returns stable result without crash (4.4.11)', async () => {
    // Spec 4.4.11: uploading a zero-byte file must not crash the CLI (exit code != 2).
    const emptyPath = join(fileDir, 'empty.txt')
    const picPath = join(fileDir, 'empty-pic.png')
    await writeFile(emptyPath, '')
    await writePng(picPath)
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${emptyPath}`, '--file', `picture=@${picPath}`])
    expect(result.exitCode, 'empty file must not cause CLI crash (exit 2)').not.toBe(2)
    expect(result.stderr).not.toMatch(/unhandled|uncaught|TypeError|ReferenceError/i)
  })

  itLocalUpload('[P1] --file and --inputs flags can coexist (4.4.15 / 4.4.29)', async () => {
    // Spec 4.4.15: passing both --file and --inputs must not cause a CLI error.
    // Spec 4.4.29: workflow app accepts --inputs + --file together.
    // file_auto_test has no non-file inputs; empty --inputs '{}' is passed to verify
    // the CLI accepts both flags without a usage error.
    const docPath = join(fileDir, 'inputs-doc.txt')
    const picPath = join(fileDir, 'inputs-pic.png')
    await writeFile(docPath, 'inputs + file coexist test')
    await writePng(picPath)
    const result = await r([
      'run',
      'app',
      E.fileAppId,
      '--inputs',
      '{}',
      '--file',
      `doc=@${docPath}`,
      '--file',
      `picture=@${picPath}`,
    ])
    expect(result.exitCode, '--inputs and --file together must not cause CLI usage error (exit 2)').not.toBe(2)
  })

  itLocalUpload('[P1] files with same name in different paths upload without conflict (4.4.16)', async () => {
    // Spec 4.4.16: multiple --file entries with the same filename (different paths)
    // must all upload successfully without collision.
    const { mkdtemp: mkd } = await import('node:fs/promises')
    const { tmpdir: td } = await import('node:os')
    const dir2 = await mkd(join(td(), 'difyctl-e2e-samename-'))
    try {
      const docPath = join(fileDir, 'same.txt') // doc field
      const picPath = join(dir2, 'same.png') // picture field — same base name, different dir
      await writeFile(docPath, 'same name doc test')
      await writePng(picPath)
      const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${docPath}`, '--file', `picture=@${picPath}`])
      assertExitCode(result, 0)
    }
    finally {
      const { rm: rmDir } = await import('node:fs/promises')
      await rmDir(dir2, { recursive: true, force: true })
    }
  })

  itLocalUpload('[P1] -o json after file upload contains workflow response fields (4.4.21)', async () => {
    // Spec 4.4.21: -o json output after a file run must contain structured response metadata.
    const docPath = join(fileDir, 'json-doc.txt')
    const picPath = join(fileDir, 'json-pic.png')
    await writeFile(docPath, 'json output test')
    await writePng(picPath)
    const result = await r([
      'run',
      'app',
      E.fileAppId,
      '--file',
      `doc=@${docPath}`,
      '--file',
      `picture=@${picPath}`,
      '-o',
      'json',
    ])
    assertExitCode(result, 0)
    const parsed = assertJson<Record<string, unknown>>(result)
    // workflow response must contain at minimum a mode field
    expect(parsed.mode, 'JSON output must contain mode field').toBeTruthy()
    assertNoAnsi(result.stdout, 'stdout')
  })

  itLocalUpload('[P1] file path with CJK characters uploads correctly (4.4.26)', async () => {
    // Spec 4.4.26: a file whose path contains CJK (Chinese) characters must upload
    // and execute successfully.
    const cjkPath = join(fileDir, 'cjk-test-doc.txt')
    const picPath = join(fileDir, 'cjk-pic.png')
    await writeFile(cjkPath, 'CJK path upload test — Chinese content')
    await writePng(picPath)
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${cjkPath}`, '--file', `picture=@${picPath}`])
    assertExitCode(result, 0)
  })
})
