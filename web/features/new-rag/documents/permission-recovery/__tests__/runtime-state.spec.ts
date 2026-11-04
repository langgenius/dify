import { describe, expect, it } from 'vitest'
import {
  createPermissionRecoveryRuntimeState,
  transitionPermissionRecoveryRuntimeState,
} from '../runtime-state'

const readable = { documents: false, sources: false, tasks: false }

describe('permission recovery runtime state', () => {
  it('recovers the child queries masked by a document denial', () => {
    const denied = createPermissionRecoveryRuntimeState({
      denials: { ...readable, documents: true },
      writable: true,
    })

    const recovered = transitionPermissionRecoveryRuntimeState(denied, {
      denials: readable,
      type: 'read-denials-changed',
    })

    expect(recovered.state.read.status).toBe('readable')
    expect(recovered.effects).toEqual([
      'reset-task-poll-blocks',
      'refetch-tasks',
      'refetch-sources',
    ])
  })

  it('does not repeat a child query that recovered before the denial clears', () => {
    const taskDenied = createPermissionRecoveryRuntimeState({
      denials: { ...readable, tasks: true },
      writable: true,
    })

    const recovered = transitionPermissionRecoveryRuntimeState(taskDenied, {
      denials: readable,
      type: 'read-denials-changed',
    })

    expect(recovered.effects).toEqual(['reset-task-poll-blocks', 'refetch-sources'])
  })

  it('keeps the latest write denial locked when an older refresh succeeds', () => {
    const initial = createPermissionRecoveryRuntimeState({ denials: readable, writable: true })
    const firstDenial = transitionPermissionRecoveryRuntimeState(initial, {
      type: 'write-denied',
    }).state
    const secondDenial = transitionPermissionRecoveryRuntimeState(firstDenial, {
      type: 'write-denied',
    }).state

    const staleSuccess = transitionPermissionRecoveryRuntimeState(secondDenial, {
      generation: firstDenial.write.generation,
      type: 'write-refresh-finished',
      writable: true,
    }).state

    expect(staleSuccess.write).toEqual(secondDenial.write)
  })

  it('retires a write lock only after the matching permission refresh', () => {
    const initial = createPermissionRecoveryRuntimeState({ denials: readable, writable: true })
    const denied = transitionPermissionRecoveryRuntimeState(initial, {
      type: 'write-denied',
    }).state
    const refreshing = transitionPermissionRecoveryRuntimeState(denied, {
      generation: denied.write.generation,
      type: 'write-refresh-started',
    }).state

    expect(refreshing.write.status).toBe('refreshing')

    const recovered = transitionPermissionRecoveryRuntimeState(refreshing, {
      generation: denied.write.generation,
      type: 'write-refresh-finished',
      writable: true,
    }).state
    expect(recovered.write.status).toBe('writable')
  })
})
