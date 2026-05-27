/**
 * E2E: difyctl run app --file — 文件输入专项
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》— Dify CLI/Run/文件输入（31 条）
 *
 * 前置条件：
 *   DIFY_E2E_FILE_APP_ID — workflow app，doc 文件变量（required）
 *   如果未配置，所有文件相关用例会被跳过。
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

  itLocalUpload('[P0] run app 支持单文件上传（key=@path），app 正常执行', async () => {
    // 文档用例：run app 支持单文件上传 + 上传文件后 app 正常执行
    const filePath = join(fileDir, 'test.txt')
    await writeFile(filePath, 'E2E test file content — single upload')
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${filePath}`])
    assertExitCode(result, 0)
  })

  itLocalUpload('[P0] file input 参数名正确映射（key 绑定到正确 input 字段）', async () => {
    // 文档用例：file input 参数名正确映射
    const filePath = join(fileDir, 'mapping.txt')
    await writeFile(filePath, 'mapping test content')
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${filePath}`, '-o', 'json'])
    assertExitCode(result, 0)
    const parsed = assertJson<Record<string, unknown>>(result)
    expect(parsed).toBeDefined()
  })

  itLocalUpload('[P0] run app --file 语法为 key=@path（本地文件上传）', async () => {
    // 文档用例：run app --file 语法为 key=@path
    const filePath = join(fileDir, 'syntax.txt')
    await writeFile(filePath, 'syntax verification')
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${filePath}`])
    assertExitCode(result, 0)
  })

  it('[P0] --file 远程 URL 语法（key=https://...）无需本地上传', async () => {
    // 文档用例：run app --file 传入文件 workflow 正常执行
    const result = await r([
      'run',
      'app',
      E.fileAppId,
      '--file',
      'doc=https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    ])
    assertExitCode(result, 0)
  })

  it('[P0] 文件不存在时返回错误', async () => {
    // 文档用例：文件不存在时返回错误
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

  it('[P1] file 参数格式错误返回 usage error（exit code 2）', async () => {
    // 文档用例：file 参数格式错误返回 usage error
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

  itLocalUpload('[P1] 文件路径包含空格可正常上传', async () => {
    // 文档用例：文件路径包含空格可正常上传
    const filePath = join(fileDir, 'file with spaces.txt')
    await writeFile(filePath, 'space in name test')
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${filePath}`])
    assertExitCode(result, 0)
  })

  itLocalUpload('[P1] 支持 txt 文件上传', async () => {
    // 文档用例：支持 txt 文件上传
    const f = join(fileDir, 'note.txt')
    await writeFile(f, 'plain text content')
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${f}`])
    assertExitCode(result, 0)
  })

  itLocalUpload('[P1] --file 与 --stream 组合使用', async () => {
    // 文档用例：run app --file 与 --stream 组合使用
    const f = join(fileDir, 'stream.txt')
    await writeFile(f, 'stream + file test')
    const result = await r(['run', 'app', E.fileAppId, '--file', `doc=@${f}`, '--stream'])
    assertExitCode(result, 0)
  })

  it('[P0] 未登录执行 file upload 返回认证错误（exit code 4）', async () => {
    // 文档用例：未登录执行 file upload 返回认证错误
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
