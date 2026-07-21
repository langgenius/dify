import { act, renderHook } from '@testing-library/react'
import {
  createAuxiliaryTaskReadGuard,
  useAuxiliaryTaskReadGuard,
} from '../auxiliary-task-read-guard'

describe('createAuxiliaryTaskReadGuard', () => {
  it('blocks every auxiliary reader for the denied task version', () => {
    const guard = createAuxiliaryTaskReadGuard()
    const olderVersion = '2026-07-20T10:01:00Z'
    const deniedVersion = '2026-07-20T10:02:00Z'
    const newerVersion = '2026-07-20T10:03:00Z'

    guard.block('task-1', deniedVersion)

    expect(guard.isBlocked('task-1', olderVersion)).toBe(true)
    expect(guard.isBlocked('task-1', deniedVersion)).toBe(true)
    expect(guard.isBlocked('task-1', newerVersion)).toBe(false)
    expect(guard.isBlocked('task-2', deniedVersion)).toBe(false)

    guard.block('task-1', olderVersion)
    expect(guard.isBlocked('task-1', olderVersion)).toBe(true)
    expect(guard.isBlocked('task-1', deniedVersion)).toBe(true)
  })

  it('retires blocks after task or document authority changes', () => {
    const guard = createAuxiliaryTaskReadGuard()
    guard.block('task-1', 'version-1')
    guard.block('task-2', 'version-1')

    guard.retain(new Set(['task-1']))
    expect(guard.isBlocked('task-1', 'version-1')).toBe(true)
    expect(guard.isBlocked('task-2', 'version-1')).toBe(false)

    guard.clearTask('task-1')
    expect(guard.isBlocked('task-1', 'version-1')).toBe(false)

    guard.block('task-1', 'version-2')
    guard.clear()
    expect(guard.isBlocked('task-1', 'version-2')).toBe(false)
  })

  it('retires a block only after an authoritative version catches up', () => {
    const guard = createAuxiliaryTaskReadGuard()
    guard.block('task-1', '2026-07-20T10:02:00Z')

    expect(guard.clearThrough('task-1', '2026-07-20T10:01:00Z')).toBe(false)
    expect(guard.isBlocked('task-1', '2026-07-20T10:02:00Z')).toBe(true)

    expect(guard.clearThrough('task-1', '2026-07-20T10:02:00Z')).toBe(true)
    expect(guard.isBlocked('task-1', '2026-07-20T10:02:00Z')).toBe(false)
  })

  it('restores the page after authoritative document verification without retrying the task version', async () => {
    let resolveRefetch!: (result: { error: null }) => void
    const refetchDocuments = vi.fn(
      () =>
        new Promise<{ error: null }>((resolve) => {
          resolveRefetch = resolve
        }),
    )
    const { result } = renderHook(() =>
      useAuxiliaryTaskReadGuard({ documentPermissionDenied: false, refetchDocuments }),
    )

    act(() => result.current.deny('task-1', 'version-1'))
    expect(result.current.permissionDenied).toBe(true)
    expect(result.current.guard.isBlocked('task-1', 'version-1')).toBe(true)

    await act(async () => resolveRefetch({ error: null }))
    expect(result.current.permissionDenied).toBe(false)
    expect(result.current.guard.isBlocked('task-1', 'version-1')).toBe(true)
  })

  it('clears local denial and version blocks after document permission returns', async () => {
    const refetchDocuments = vi
      .fn()
      .mockResolvedValue({ error: new Response(null, { status: 403 }) })
    const { result, rerender } = renderHook(
      ({ documentPermissionDenied }) =>
        useAuxiliaryTaskReadGuard({ documentPermissionDenied, refetchDocuments }),
      { initialProps: { documentPermissionDenied: false } },
    )

    act(() => result.current.deny('task-1', 'version-1'))
    await act(async () => {})
    expect(result.current.permissionDenied).toBe(true)

    rerender({ documentPermissionDenied: true })
    rerender({ documentPermissionDenied: false })

    expect(result.current.permissionDenied).toBe(false)
    expect(result.current.guard.isBlocked('task-1', 'version-1')).toBe(false)
    expect(result.current.guardRevision).toBe(1)
  })
})
