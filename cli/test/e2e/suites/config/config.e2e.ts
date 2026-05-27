/**
 * E2E: difyctl config — 配置管理
 *
 * 用例来源：飞书文档《Dify CLI Enhanced》
 *   - Dify CLI/Config/初始化与默认路径（26 条，可测部分）
 *   - Dify CLI/Config/环境变量覆盖优先级（26 条，可测部分）
 *
 * 覆盖子命令：config path / config get / config set / config unset / config view
 * 不依赖真实 Dify 服务器，所有用例纯本地执行。
 */

import { access, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertExitCode, assertNoAnsi } from '../../helpers/assert.js'
import { run, withTempConfig } from '../../helpers/cli.js'

describe('E2E / difyctl config', () => {
  let configDir: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await withTempConfig()
    configDir = tmp.configDir
    cleanup = tmp.cleanup
  })
  afterEach(async () => {
    await cleanup()
  })

  function r(argv: string[], extraEnv?: Record<string, string>) {
    return run(argv, { configDir, env: extraEnv })
  }

  // ── config path ──────────────────────────────────────────────────────────

  it('[P0] config path 返回正确的 config.yml 绝对路径', async () => {
    // 文档用例：默认 config 路径正确
    const result = await r(['config', 'path'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe(join(configDir, 'config.yml'))
  })

  it('[P0] config path 输出以换行符结尾', async () => {
    const result = await r(['config', 'path'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/config\.yml\n$/)
  })

  // ── config set / get ─────────────────────────────────────────────────────

  it('[P0] config set defaults.format 写入成功，stdout 含 key=value', async () => {
    const result = await r(['config', 'set', 'defaults.format', 'json'])
    assertExitCode(result, 0)
    expect(result.stdout).toMatch(/defaults\.format/)
  })

  it('[P0] config get 读取已写入的 defaults.format', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    const result = await r(['config', 'get', 'defaults.format'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('json')
  })

  it('[P0] config set defaults.limit 写入并读取正确', async () => {
    await r(['config', 'set', 'defaults.limit', '50'])
    const result = await r(['config', 'get', 'defaults.limit'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('50')
  })

  it('[P0] config set state.current_app 写入并读取正确', async () => {
    const appId = 'app-e2e-config-test'
    await r(['config', 'set', 'state.current_app', appId])
    const result = await r(['config', 'get', 'state.current_app'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe(appId)
  })

  it('[P0] config get 未设置的 key 返回空值（exit 0）', async () => {
    // 文档用例：config 文件缺少字段时使用默认值
    const result = await r(['config', 'get', 'defaults.format'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('')
  })

  it('[P1] 多次 config set 不同 key，各 key 独立持久化', async () => {
    // 文档用例：config 已存在时不重复覆盖
    await r(['config', 'set', 'defaults.format', 'yaml'])
    await r(['config', 'set', 'defaults.limit', '30'])
    const fmt = await r(['config', 'get', 'defaults.format'])
    const lim = await r(['config', 'get', 'defaults.limit'])
    expect(fmt.stdout.trim()).toBe('yaml')
    expect(lim.stdout.trim()).toBe('30')
  })

  // ── config unset ─────────────────────────────────────────────────────────

  it('[P0] config unset 清除已设置的 key，get 返回空值', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    await r(['config', 'unset', 'defaults.format'])
    const result = await r(['config', 'get', 'defaults.format'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('')
  })

  it('[P1] config unset 未设置的 key 幂等成功（exit 0）', async () => {
    const result = await r(['config', 'unset', 'defaults.format'])
    assertExitCode(result, 0)
  })

  it('[P1] config unset 后其他 key 不受影响', async () => {
    await r(['config', 'set', 'defaults.format', 'table'])
    await r(['config', 'set', 'defaults.limit', '10'])
    await r(['config', 'unset', 'defaults.format'])
    const lim = await r(['config', 'get', 'defaults.limit'])
    expect(lim.stdout.trim()).toBe('10')
  })

  // ── config view ──────────────────────────────────────────────────────────

  it('[P0] config view 空配置输出为空', async () => {
    const result = await r(['config', 'view'])
    assertExitCode(result, 0)
    expect(result.stdout.trim()).toBe('')
  })

  it('[P0] config view 显示所有已设置的 key = value', async () => {
    await r(['config', 'set', 'defaults.format', 'yaml'])
    await r(['config', 'set', 'defaults.limit', '20'])
    const result = await r(['config', 'view'])
    assertExitCode(result, 0)
    expect(result.stdout).toContain('defaults.format = yaml')
    expect(result.stdout).toContain('defaults.limit = 20')
  })

  it('[P0] config view --json 输出合法 JSON，含已设置 key', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    await r(['config', 'set', 'defaults.limit', '15'])
    const result = await r(['config', 'view', '--json'])
    assertExitCode(result, 0)
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    expect(parsed).toHaveProperty('defaults.format', 'json')
    expect(parsed).toHaveProperty('defaults.limit', 15)
  })

  it('[P1] config view --json 空配置输出合法空 JSON 对象', async () => {
    const result = await r(['config', 'view', '--json'])
    assertExitCode(result, 0)
    const parsed = JSON.parse(result.stdout)
    expect(typeof parsed).toBe('object')
  })

  // ── 初始化与默认路径 ──────────────────────────────────────────────────────

  it('[P0] 首次 config set 自动创建 config 目录和 config.yml 文件', async () => {
    // 文档用例：首次启动自动创建 config 目录 / 自动创建 config 文件
    await r(['config', 'set', 'defaults.format', 'json'])
    await expect(access(join(configDir, 'config.yml'))).resolves.toBeUndefined()
  })

  it('[P0] config.yml 文件权限为 0o600', async () => {
    // 文档用例：config 文件默认权限正确
    await r(['config', 'set', 'defaults.format', 'json'])
    const info = await stat(join(configDir, 'config.yml'))
    expect(info.mode & 0o777).toBe(0o600)
  })

  it('[P0] config.yml 包含正确的 schema_version 字段', async () => {
    // 文档用例：config 文件默认 schema 正确
    await r(['config', 'set', 'defaults.format', 'json'])
    const raw = await import('node:fs/promises').then(fs =>
      fs.readFile(join(configDir, 'config.yml'), 'utf8'),
    )
    expect(raw).toMatch(/schema_version/)
  })

  it('[P0] config 内容为非法 YAML 时返回解析错误', async () => {
    // 文档用例：config 内容非法时返回错误
    await mkdir(configDir, { recursive: true })
    await writeFile(join(configDir, 'config.yml'), ': broken: yaml: [[[', { mode: 0o600 })
    const result = await r(['config', 'get', 'defaults.format'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/parse|yaml|config/i)
  })

  it('[P0] schema_version 高于当前版本时返回 config_schema_unsupported 错误', async () => {
    // 文档用例：config 文件 schema_version 高于支持版本时返回错误
    await mkdir(configDir, { recursive: true })
    await writeFile(
      join(configDir, 'config.yml'),
      'schema_version: 999\ndefaults: {}\nstate: {}\n',
      { mode: 0o600 },
    )
    const result = await r(['config', 'get', 'defaults.format'])
    expect(result.exitCode).toBe(6) // VersionCompat
    expect(result.stderr).toMatch(/schema_version|unsupported|upgrade/i)
  })

  it('[P0] DIFY_CONFIG_DIR 覆盖默认路径，config path 返回指定目录下的路径', async () => {
    // 文档用例：DIFYCTL_CONFIG 环境变量覆盖默认路径
    const altDir = await mkdtemp(join(tmpdir(), 'difyctl-alt-'))
    try {
      const result = await run(['config', 'path'], { configDir: altDir })
      assertExitCode(result, 0)
      expect(result.stdout.trim()).toBe(join(altDir, 'config.yml'))
    }
    finally {
      await rm(altDir, { recursive: true, force: true })
    }
  })

  it('[P0] 临时 DIFY_CONFIG_DIR 不影响原 config 目录的内容', async () => {
    // 文档用例：临时 env 注入不修改 config 文件
    await r(['config', 'set', 'defaults.format', 'yaml'])

    const altDir = await mkdtemp(join(tmpdir(), 'difyctl-alt-'))
    try {
      await run(['config', 'set', 'defaults.format', 'json'], { configDir: altDir })
      // 原 configDir 内容不变
      const original = await r(['config', 'get', 'defaults.format'])
      expect(original.stdout.trim()).toBe('yaml')
    }
    finally {
      await rm(altDir, { recursive: true, force: true })
    }
  })

  // ── 错误场景 ──────────────────────────────────────────────────────────────

  it('[P0] config get 未知 key 返回 exit code 2', async () => {
    const result = await r(['config', 'get', 'unknown.key'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/unknown config key/i)
  })

  it('[P0] config set 未知 key 返回 exit code 2', async () => {
    const result = await r(['config', 'set', 'unknown.key', 'val'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/unknown config key/i)
  })

  it('[P0] config unset 未知 key 返回 exit code 2', async () => {
    const result = await r(['config', 'unset', 'unknown.key'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/unknown config key/i)
  })

  it('[P0] config set defaults.format 非法值返回 exit code 2', async () => {
    // 文档用例：config_invalid_value → usage error
    const result = await r(['config', 'set', 'defaults.format', 'not_a_format'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toMatch(/defaults\.format|not one of/i)
  })

  it('[P0] config set defaults.limit 0 低于最小值返回 exit code 2', async () => {
    const result = await r(['config', 'set', 'defaults.limit', '0'])
    expect(result.exitCode).toBe(2)
  })

  it('[P0] config set defaults.limit 201 超出最大值返回 exit code 2', async () => {
    const result = await r(['config', 'set', 'defaults.limit', '201'])
    expect(result.exitCode).toBe(2)
  })

  it('[P0] config set defaults.limit 非数字字符串返回 exit code 2', async () => {
    const result = await r(['config', 'set', 'defaults.limit', 'abc'])
    expect(result.exitCode).toBe(2)
  })

  it('[P1] config set 缺少 value 参数返回错误', async () => {
    const result = await r(['config', 'set', 'defaults.format'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/missing required argument/i)
  })

  it('[P1] config get 缺少 key 参数返回错误', async () => {
    const result = await r(['config', 'get'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/missing required argument/i)
  })

  // ── 输出格式 ──────────────────────────────────────────────────────────────

  it('[P0] config 输出无 ANSI color（非 TTY 环境）', async () => {
    await r(['config', 'set', 'defaults.format', 'json'])
    const result = await r(['config', 'view'])
    assertExitCode(result, 0)
    assertNoAnsi(result.stdout, 'stdout')
  })

  it('[P0] config 初始化/操作不泄露敏感信息（token/secret）', async () => {
    // 文档用例：config 初始化日志不泄露敏感信息
    const result = await r(['config', 'view'])
    assertExitCode(result, 0)
    expect(result.stdout + result.stderr).not.toMatch(/dfoa_|dfoe_|secret|password/i)
  })
})
