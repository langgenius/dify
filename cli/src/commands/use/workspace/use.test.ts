import type {
  WorkspaceDetailResponse,
  WorkspaceListResponse,
} from '@dify/contracts/api/openapi/types.gen'
import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import { useTempConfigDir } from '@test/fixtures/config-dir'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Registry } from '@/auth/hosts'
import { selectFromList } from '@/sys/io/select'
import { bufferStreams } from '@/sys/io/streams'
import { runUseWorkspace } from './use.js'

vi.mock('@/sys/io/select', () => ({
  selectFromList: vi.fn(),
}))

const selectFromListMock = vi.mocked(selectFromList)

function makeRegistry(): Registry {
  const reg = Registry.empty('file')
  reg.upsert('cloud.dify.ai', 'tester@dify.ai', {
    account: { id: 'acct-1', email: 'tester@dify.ai', name: 'Tester' },
    workspace: { id: 'ws-1', name: 'Default', role: 'owner' },
  })
  reg.setHost('cloud.dify.ai')
  reg.setAccount('tester@dify.ai')
  return reg
}

function makeActive(reg: Registry): ActiveContext {
  const active = reg.resolveActive()
  if (active === undefined) throw new Error('resolveActive returned undefined in test setup')
  return active
}

function makeDetail(over: Partial<WorkspaceDetailResponse> = {}): WorkspaceDetailResponse {
  return {
    id: '00000000-0000-0000-0000-000000000002',
    name: 'Two',
    role: 'owner',
    status: 'normal',
    current: true,
    created_at: '2026-05-18T00:00:00Z',
    ...over,
  }
}

function fakeClient(opts: {
  switch?: () => Promise<WorkspaceDetailResponse>
  list?: () => Promise<WorkspaceListResponse>
}) {
  return {
    switch: vi.fn(opts.switch ?? (() => Promise.resolve(makeDetail()))),
    list: vi.fn(
      opts.list ??
        (() =>
          Promise.resolve({
            workspaces: [
              { id: 'ws-1', name: 'Default', role: 'owner', status: 'normal', current: true },
              {
                id: '00000000-0000-0000-0000-000000000002',
                name: 'Two',
                role: 'owner',
                status: 'normal',
                current: false,
              },
            ],
          })),
    ),
  }
}

describe('runUseWorkspace', () => {
  useTempConfigDir('difyctl-use-workspace-')

  beforeEach(() => {
    selectFromListMock.mockReset()
  })

  it('arg path: switches directly without listing and persists only the active workspace', async () => {
    const io = bufferStreams()
    const reg = makeRegistry()
    await reg.save()
    const active = makeActive(reg)
    const client = fakeClient({})

    const next = await runUseWorkspace(
      { workspaceId: '00000000-0000-0000-0000-000000000002' },
      {
        reg,
        active,
        http: {} as HttpClient,
        io,
        workspacesFactory: () => client as never,
      },
    )

    expect(client.switch).toHaveBeenCalledExactlyOnceWith('00000000-0000-0000-0000-000000000002')
    expect(client.list).not.toHaveBeenCalled()

    const activeCtx = next.resolveActive()
    expect(activeCtx?.ctx.workspace).toEqual({
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Two',
      role: 'owner',
    })
    expect(
      (activeCtx?.ctx as Record<string, unknown> | undefined)?.available_workspaces,
    ).toBeUndefined()

    const reloaded = await Registry.load()
    const reloadedActive = reloaded?.resolveActive()
    expect(reloadedActive?.ctx.workspace?.id).toBe('00000000-0000-0000-0000-000000000002')
    expect(reloadedActive?.ctx.workspace?.name).toBe('Two')
    expect(
      (reloadedActive?.ctx as Record<string, unknown> | undefined)?.available_workspaces,
    ).toBeUndefined()

    expect(io.outBuf()).toMatch(/Switched to Two \(00000000-0000-0000-0000-000000000002\)/)
  })

  it('no-arg + no-TTY: rejects with usage_missing_arg and never switches', async () => {
    const io = bufferStreams()
    io.isErrTTY = false
    const reg = makeRegistry()
    await reg.save()
    const active = makeActive(reg)
    const client = fakeClient({})

    await expect(
      runUseWorkspace(
        { workspaceId: undefined },
        { reg, active, http: {} as HttpClient, io, workspacesFactory: () => client as never },
      ),
    ).rejects.toMatchObject({ code: 'usage_missing_arg' })

    expect(client.switch).not.toHaveBeenCalled()
    expect(client.list).not.toHaveBeenCalled()
  })

  it('switch failure: rejects and leaves the active workspace untouched', async () => {
    const io = bufferStreams()
    const reg = makeRegistry()
    await reg.save()
    const active = makeActive(reg)
    const before = await Registry.load()

    const client = fakeClient({
      switch: () => Promise.reject(new Error('forbidden')),
    })

    await expect(
      runUseWorkspace(
        { workspaceId: '00000000-0000-0000-0000-000000000002' },
        { reg, active, http: {} as HttpClient, io, workspacesFactory: () => client as never },
      ),
    ).rejects.toThrow(/forbidden/)

    const after = await Registry.load()
    expect(after).toEqual(before)
    expect(after?.resolveActive()?.ctx.workspace?.id).toBe('ws-1')
  })

  it('picker path (TTY): lists live workspaces and switches to the selected one', async () => {
    const io = bufferStreams()
    io.isErrTTY = true
    const reg = makeRegistry()
    await reg.save()
    const active = makeActive(reg)
    const client = fakeClient({})

    selectFromListMock.mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Two',
      role: 'owner',
    })

    await runUseWorkspace(
      { workspaceId: undefined },
      { reg, active, http: {} as HttpClient, io, workspacesFactory: () => client as never },
    )

    expect(client.list).toHaveBeenCalledOnce()
    expect(selectFromListMock).toHaveBeenCalledOnce()
    const passed = selectFromListMock.mock.calls[0]![0]
    expect(passed.items).toEqual([
      { id: 'ws-1', name: 'Default', role: 'owner' },
      { id: '00000000-0000-0000-0000-000000000002', name: 'Two', role: 'owner' },
    ])
    expect(client.switch).toHaveBeenCalledExactlyOnceWith('00000000-0000-0000-0000-000000000002')

    const reloadedActive = (await Registry.load())?.resolveActive()
    expect(reloadedActive?.ctx.workspace?.id).toBe('00000000-0000-0000-0000-000000000002')
  })
})
