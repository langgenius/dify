import type {
  WorkspaceDetailResponse,
  WorkspaceListResponse,
} from '@dify/contracts/api/openapi/types.gen'
import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '@/auth/hosts'
import { ENV_CONFIG_DIR } from '@/store/dir'
import { bufferStreams } from '@/sys/io/streams'
import { runUseWorkspace } from './use.js'

function makeRegistry(): Registry {
  const reg = Registry.empty('file')
  reg.upsert('cloud.dify.ai', 'tester@dify.ai', {
    account: { id: 'acct-1', email: 'tester@dify.ai', name: 'Tester' },
    workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
    available_workspaces: [
      { id: 'ws-1', name: 'Default', role: 'owner' },
      { id: 'ws-2', name: 'Stale Name', role: 'normal' },
    ],
  })
  reg.setHost('cloud.dify.ai')
  reg.setAccount('tester@dify.ai')
  return reg
}

function makeActive(reg: Registry): ActiveContext {
  const active = reg.resolveActive()
  if (active === undefined)
    throw new Error('resolveActive returned undefined in test setup')
  return active
}

function fakeClient(opts: {
  switch?: () => Promise<WorkspaceDetailResponse>
  list?: () => Promise<WorkspaceListResponse>
}) {
  return {
    switch: vi.fn(opts.switch ?? (() => Promise.resolve({
      id: 'ws-2',
      name: 'Switched',
      role: 'normal',
      status: 'normal',
      current: true,
      created_at: '2026-05-18T00:00:00Z',
    }))),
    list: vi.fn(opts.list ?? (() => Promise.resolve({
      workspaces: [
        { id: 'ws-1', name: 'Default', role: 'owner', status: 'normal', current: false },
        { id: 'ws-2', name: 'Switched', role: 'normal', status: 'normal', current: true },
      ],
    }))),
  }
}

describe('runUseWorkspace', () => {
  let configDir: string

  let prevConfigDir: string | undefined
  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'difyctl-use-workspace-'))
    prevConfigDir = process.env[ENV_CONFIG_DIR]
    process.env[ENV_CONFIG_DIR] = configDir
  })
  afterEach(async () => {
    if (prevConfigDir === undefined)
      delete process.env[ENV_CONFIG_DIR]
    else
      process.env[ENV_CONFIG_DIR] = prevConfigDir
    await rm(configDir, { recursive: true, force: true })
  })

  it('happy path: POST /switch → GET /workspaces → write hosts.yml', async () => {
    const io = bufferStreams()
    const reg = makeRegistry()
    reg.save()
    const active = makeActive(reg)
    const client = fakeClient({})

    const next = await runUseWorkspace(
      { workspaceId: 'ws-2' },
      {
        reg,
        active,
        http: {} as HttpClient,
        io,
        workspacesFactory: () => client as never,
      },
    )

    expect(client.switch).toHaveBeenCalledExactlyOnceWith('ws-2')
    expect(client.list).toHaveBeenCalledOnce()

    const activeCtx = next.resolveActive()
    expect(activeCtx?.ctx.workspace).toEqual({ id: 'ws-2', name: 'Switched', role: 'normal' })
    expect(activeCtx?.ctx.available_workspaces).toEqual([
      { id: 'ws-1', name: 'Default', role: 'owner' },
      { id: 'ws-2', name: 'Switched', role: 'normal' },
    ])

    const reloaded = Registry.load()
    const reloadedActive = reloaded?.resolveActive()
    expect(reloadedActive?.ctx.workspace?.id).toBe('ws-2')
    expect(reloadedActive?.ctx.workspace?.name).toBe('Switched')

    expect(io.outBuf()).toMatch(/Switched to Switched \(ws-2\)/)
  })

  it('hosts.yml contains no bearer after switch', async () => {
    const io = bufferStreams()
    const reg = makeRegistry()
    reg.save()
    const active = makeActive(reg)
    const client = fakeClient({})

    await runUseWorkspace(
      { workspaceId: 'ws-2' },
      { reg, active, http: {} as HttpClient, io, workspacesFactory: () => client as never },
    )

    const reloaded = Registry.load()
    const raw = JSON.stringify(reloaded)
    expect(raw).not.toMatch(/bearer/)
  })

  it('refreshes stale workspace name from server', async () => {
    // registry has ws-2 named "Stale Name"; server returns "Switched".
    // We expect saveRegistry to record the fresh name from the server.
    const io = bufferStreams()
    const reg = makeRegistry()
    reg.save()
    const active = makeActive(reg)
    const client = fakeClient({})

    await runUseWorkspace(
      { workspaceId: 'ws-2' },
      { reg, active, http: {} as HttpClient, io, workspacesFactory: () => client as never },
    )

    const reloaded = Registry.load()
    const reloadedActive = reloaded?.resolveActive()
    expect(reloadedActive?.ctx.workspace?.name).toBe('Switched')
    expect(reloadedActive?.ctx.available_workspaces?.find(w => w.id === 'ws-2')?.name).toBe('Switched')
  })

  it('does NOT mutate hosts.yml when POST /switch fails', async () => {
    const io = bufferStreams()
    const reg = makeRegistry()
    reg.save()
    const active = makeActive(reg)
    const before = Registry.load()

    const client = fakeClient({
      switch: () => Promise.reject(new Error('forbidden')),
    })

    await expect(
      runUseWorkspace(
        { workspaceId: 'ws-2' },
        {
          reg,
          active,
          http: {} as HttpClient,
          io,
          workspacesFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/forbidden/)

    expect(client.list).not.toHaveBeenCalled()
    const after = Registry.load()
    expect(after).toEqual(before)
    const afterActive = after?.resolveActive()
    expect(afterActive?.ctx.workspace?.id).toBe('ws-1')
  })

  it('does NOT mutate hosts.yml when GET /workspaces fails after switch', async () => {
    const io = bufferStreams()
    const reg = makeRegistry()
    reg.save()
    const active = makeActive(reg)
    const before = Registry.load()

    const client = fakeClient({
      list: () => Promise.reject(new Error('transient list failure')),
    })

    await expect(
      runUseWorkspace(
        { workspaceId: 'ws-2' },
        {
          reg,
          active,
          http: {} as HttpClient,
          io,
          workspacesFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/transient list failure/)

    const after = Registry.load()
    expect(after).toEqual(before)
  })

  it('throws when server returns switch=<id> but id is missing from /workspaces list', async () => {
    const io = bufferStreams()
    const reg = makeRegistry()
    reg.save()
    const active = makeActive(reg)

    const client = fakeClient({
      switch: () => Promise.resolve({
        id: 'ws-7',
        name: 'Ghost',
        role: 'normal',
        status: 'normal',
        current: true,
        created_at: null as unknown as string,
      }),
      list: () => Promise.resolve({
        workspaces: [
          { id: 'ws-1', name: 'Default', role: 'owner', status: 'normal', current: false },
        ],
      }),
    })

    await expect(
      runUseWorkspace(
        { workspaceId: 'ws-7' },
        {
          reg,
          active,
          http: {} as HttpClient,
          io,
          workspacesFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/not visible in \/workspaces/)
  })
})
