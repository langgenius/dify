import type {
  WorkspaceDetailResponse,
  WorkspaceListResponse,
} from '@dify/contracts/api/openapi/types.gen'
import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../../auth/hosts.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadHosts, saveHosts } from '../../../auth/hosts.js'
import { ENV_CONFIG_DIR } from '../../../store/dir.js'
import { bufferStreams } from '../../../sys/io/streams.js'
import { runUseWorkspace } from './use.js'

function bundle(): HostsBundle {
  return {
    current_host: 'cloud.dify.ai',
    token_storage: 'file',
    tokens: { bearer: 'dfoa_test' },
    account: { id: 'acct-1', email: 'tester@dify.ai', name: 'Tester' },
    workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
    available_workspaces: [
      { id: 'ws-1', name: 'Default', role: 'owner' },
      { id: 'ws-2', name: 'Stale Name', role: 'normal' },
    ],
  }
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
    const b = bundle()
    saveHosts(b)
    const client = fakeClient({})

    const next = await runUseWorkspace(
      { workspaceId: 'ws-2' },
      {
        bundle: b,
        http: {} as KyInstance,
        io,
        workspacesFactory: () => client as never,
      },
    )

    expect(client.switch).toHaveBeenCalledExactlyOnceWith('ws-2')
    expect(client.list).toHaveBeenCalledOnce()
    expect(next.workspace).toEqual({ id: 'ws-2', name: 'Switched', role: 'normal' })
    expect(next.available_workspaces).toEqual([
      { id: 'ws-1', name: 'Default', role: 'owner' },
      { id: 'ws-2', name: 'Switched', role: 'normal' },
    ])
    const reloaded = loadHosts()
    expect(reloaded?.workspace?.id).toBe('ws-2')
    expect(reloaded?.workspace?.name).toBe('Switched')
    expect(io.outBuf()).toMatch(/Switched to Switched \(ws-2\)/)
  })

  it('refreshes stale workspace name from server', async () => {
    // bundle has ws-2 named "Stale Name"; server returns "Switched".
    // We expect saveHosts to record the fresh name from the server.
    const io = bufferStreams()
    const b = bundle()
    saveHosts(b)
    const client = fakeClient({})

    await runUseWorkspace(
      { workspaceId: 'ws-2' },
      { bundle: b, http: {} as KyInstance, io, workspacesFactory: () => client as never },
    )

    const reloaded = loadHosts()
    expect(reloaded?.workspace?.name).toBe('Switched')
    expect(reloaded?.available_workspaces?.find(w => w.id === 'ws-2')?.name).toBe('Switched')
  })

  it('does NOT mutate hosts.yml when POST /switch fails', async () => {
    const io = bufferStreams()
    const b = bundle()
    saveHosts(b)
    const before = loadHosts()

    const client = fakeClient({
      switch: () => Promise.reject(new Error('forbidden')),
    })

    await expect(
      runUseWorkspace(
        { workspaceId: 'ws-2' },
        {
          bundle: b,
          http: {} as KyInstance,
          io,
          workspacesFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/forbidden/)

    expect(client.list).not.toHaveBeenCalled()
    const after = loadHosts()
    expect(after).toEqual(before)
    expect(after?.workspace?.id).toBe('ws-1')
  })

  it('does NOT mutate hosts.yml when GET /workspaces fails after switch', async () => {
    const io = bufferStreams()
    const b = bundle()
    saveHosts(b)
    const before = loadHosts()

    const client = fakeClient({
      list: () => Promise.reject(new Error('transient list failure')),
    })

    await expect(
      runUseWorkspace(
        { workspaceId: 'ws-2' },
        {
          bundle: b,
          http: {} as KyInstance,
          io,
          workspacesFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/transient list failure/)

    const after = loadHosts()
    expect(after).toEqual(before)
  })

  it('throws when server returns switch=<id> but id is missing from /workspaces list', async () => {
    const io = bufferStreams()
    const b = bundle()
    saveHosts(b)

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
          bundle: b,
          http: {} as KyInstance,
          io,
          workspacesFactory: () => client as never,
        },
      ),
    ).rejects.toThrow(/not visible in \/workspaces/)
  })
})
