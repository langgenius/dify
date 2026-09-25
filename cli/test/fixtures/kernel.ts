import type { DifyMock } from '@test/fixtures/dify-mock/server'
import type { Override } from '@/kernel/context'
import type { Login } from '@/plugins/session'
import type { BufferStreams } from '@/sys/io/streams'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMock } from '@test/fixtures/dify-mock/server'
import { Context } from '@/kernel/context'
import { argv } from '@/plugins/argv'
import { ENV } from '@/plugins/env'
import { io, ioService } from '@/plugins/io'
import { resolveOutput } from '@/plugins/output'
import { session } from '@/plugins/session'
import { token } from '@/plugins/token'
import { bufferStreams } from '@/sys/io/streams'

export type TestWorld = {
  ctx: Context
  io: BufferStreams
  mock: DifyMock
  dir: string
  overrides: Override[]
  stop: () => Promise<void>
}

export type TestWorldOptions = {
  readonly login: boolean
  readonly argv?: readonly string[]
  readonly env?: boolean
  readonly stdin?: string
  readonly tty?: boolean
  /** Share another world's temp dir and mock instead of making new ones. */
  readonly reuseDirOf?: TestWorld
}

const TEMP_PREFIX = 'difyctl-world-'
const FILE_EMAIL = 'me@x'
const FILE_WORKSPACE_ID = 'ws-1'
const FILE_LOGIN_TOKEN = 'dfoa_file'
const ENV_LOGIN_TOKEN = 'dfoa_env'

type EnvPatch = Readonly<Record<string, string | undefined>>

function applyEnv(patch: EnvPatch): () => void {
  const saved = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(patch)) {
    saved.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function writeFileLogin(server: string): Promise<void> {
  const boot = new Context()
  const sessionService = await boot.get(session)
  const tokenService = await boot.get(token)
  const login: Login = {
    server,
    email: FILE_EMAIL,
    account: null,
    workspaceId: FILE_WORKSPACE_ID,
    tokenStorage: 'file',
    insecure: false,
  }
  await sessionService.save(login)
  await tokenService.write(login, FILE_LOGIN_TOKEN)
}

export async function testContext(opts: TestWorldOptions): Promise<TestWorld> {
  const shared = opts.reuseDirOf
  const mock = shared === undefined ? await startMock() : shared.mock
  const dir = shared === undefined ? await mkdtemp(join(tmpdir(), TEMP_PREFIX)) : shared.dir

  const restoreEnv = applyEnv({
    [ENV.ConfigDir]: dir,
    [ENV.CacheDir]: dir,
    [ENV.Server]: opts.env === true ? mock.url : undefined,
    [ENV.Token]: opts.env === true ? ENV_LOGIN_TOKEN : undefined,
    [ENV.WorkspaceId]: undefined,
  })

  if (opts.login) await writeFileLogin(mock.url)

  const streams = bufferStreams(opts.stdin ?? '')
  streams.isOutTTY = streams.isErrTTY = opts.tty === true
  const overrides: Override[] = [
    [io, ioService(streams, resolveOutput({ argv: opts.argv ?? [], env: {}, streams }))],
    [argv, opts.argv ?? []],
  ]

  return {
    ctx: new Context(overrides),
    io: streams,
    mock,
    dir,
    overrides,
    stop: async () => {
      restoreEnv()
      if (shared !== undefined) return
      await mock.stop()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
