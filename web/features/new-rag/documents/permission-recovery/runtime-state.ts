export type PermissionRecoveryReadStatus = 'readable' | 'readDenied' | 'retrying'
export type PermissionRecoveryWriteStatus = 'writable' | 'writeDenied' | 'refreshing' | 'readOnly'

const DOCUMENT_DENIED = 1
const TASK_DENIED = 2
const SOURCE_DENIED = 4

export type ReadPermissionDenials = {
  documents: boolean
  sources: boolean
  tasks: boolean
}

export type PermissionRecoveryRuntimeState = {
  read: {
    activeDenials: number
    recoveryQueries: number
    status: PermissionRecoveryReadStatus
  }
  write: {
    generation: number
    status: PermissionRecoveryWriteStatus
  }
}

export type PermissionRecoveryEffect =
  | 'refetch-sources'
  | 'refetch-tasks'
  | 'reset-task-poll-blocks'

export type PermissionRecoveryEvent =
  | { denials: ReadPermissionDenials; type: 'read-denials-changed' }
  | { type: 'read-retry-requested' }
  | { type: 'write-denied' }
  | { generation: number; type: 'write-refresh-started' }
  | { generation: number; type: 'write-refresh-finished'; writable: boolean }
  | { type: 'workspace-permission-changed'; writable: boolean }

function denialMask({ documents, sources, tasks }: ReadPermissionDenials) {
  return (
    (documents ? DOCUMENT_DENIED : 0) | (tasks ? TASK_DENIED : 0) | (sources ? SOURCE_DENIED : 0)
  )
}

function recoveryQueriesForDenials(activeDenials: number) {
  let recoveryQueries = 0
  if (activeDenials & DOCUMENT_DENIED) recoveryQueries |= TASK_DENIED | SOURCE_DENIED
  if (activeDenials & TASK_DENIED) recoveryQueries |= SOURCE_DENIED
  if (activeDenials & SOURCE_DENIED) recoveryQueries |= TASK_DENIED
  return recoveryQueries & ~activeDenials
}

export function createPermissionRecoveryRuntimeState({
  denials,
  writable,
}: {
  denials: ReadPermissionDenials
  writable: boolean
}): PermissionRecoveryRuntimeState {
  const activeDenials = denialMask(denials)
  return {
    read: {
      activeDenials,
      recoveryQueries: recoveryQueriesForDenials(activeDenials),
      status: activeDenials ? 'readDenied' : 'readable',
    },
    write: {
      generation: 0,
      status: writable ? 'writable' : 'readOnly',
    },
  }
}

export function transitionPermissionRecoveryRuntimeState(
  state: PermissionRecoveryRuntimeState,
  event: PermissionRecoveryEvent,
): { effects: PermissionRecoveryEffect[]; state: PermissionRecoveryRuntimeState } {
  if (event.type === 'read-retry-requested') {
    if (!state.read.activeDenials) return { effects: [], state }
    return {
      effects: [],
      state: { ...state, read: { ...state.read, status: 'retrying' } },
    }
  }

  if (event.type === 'read-denials-changed') {
    const activeDenials = denialMask(event.denials)
    const previousDenials = state.read.activeDenials
    if (activeDenials === previousDenials) return { effects: [], state }
    const addedDenials = activeDenials & ~previousDenials
    let recoveryQueries = state.read.recoveryQueries | recoveryQueriesForDenials(addedDenials)

    if (previousDenials & TASK_DENIED && !(activeDenials & TASK_DENIED))
      recoveryQueries &= ~TASK_DENIED
    if (previousDenials & SOURCE_DENIED && !(activeDenials & SOURCE_DENIED))
      recoveryQueries &= ~SOURCE_DENIED
    recoveryQueries &= ~activeDenials

    if (activeDenials) {
      return {
        effects: [],
        state: {
          ...state,
          read: {
            activeDenials,
            recoveryQueries,
            status: state.read.status === 'retrying' ? 'retrying' : 'readDenied',
          },
        },
      }
    }

    const effects: PermissionRecoveryEffect[] = []
    if (previousDenials) {
      effects.push('reset-task-poll-blocks')
      if (recoveryQueries & TASK_DENIED) effects.push('refetch-tasks')
      if (recoveryQueries & SOURCE_DENIED) effects.push('refetch-sources')
    }
    return {
      effects,
      state: {
        ...state,
        read: { activeDenials: 0, recoveryQueries: 0, status: 'readable' },
      },
    }
  }

  if (event.type === 'write-denied') {
    return {
      effects: [],
      state: {
        ...state,
        write: { generation: state.write.generation + 1, status: 'writeDenied' },
      },
    }
  }

  if (event.type === 'write-refresh-started') {
    if (event.generation !== state.write.generation) return { effects: [], state }
    return {
      effects: [],
      state: { ...state, write: { ...state.write, status: 'refreshing' } },
    }
  }

  if (event.type === 'write-refresh-finished') {
    if (event.generation !== state.write.generation) return { effects: [], state }
    return {
      effects: [],
      state: {
        ...state,
        write: { ...state.write, status: event.writable ? 'writable' : 'readOnly' },
      },
    }
  }

  if (event.writable && state.write.status !== 'writable') {
    return {
      effects: [],
      state: { ...state, write: { ...state.write, status: 'writable' } },
    }
  }
  if (!event.writable && state.write.status === 'writable') {
    return {
      effects: [],
      state: { ...state, write: { ...state.write, status: 'readOnly' } },
    }
  }
  return { effects: [], state }
}
