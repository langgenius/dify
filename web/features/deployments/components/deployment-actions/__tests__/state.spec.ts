import type { Getter } from 'jotai/vanilla'
import { skipToken } from '@tanstack/react-query'
import { atom, createStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  queryKey?: readonly unknown[]
}

type QueryResult = {
  data?: unknown
}

type MutationOptions = {
  mutationKey?: readonly string[]
}

type MutationResult = {
  isPending: boolean
  mutate: ReturnType<typeof vi.fn>
  mutateAsync: ReturnType<typeof vi.fn>
}

const mockQueryResults = vi.hoisted(() => ({
  current: new Map<string, QueryResult>(),
}))

const mockUpdateMutation = vi.hoisted<{ current: MutationResult }>(() => ({
  current: {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  },
}))

const mockDeleteMutation = vi.hoisted<{ current: MutationResult }>(() => ({
  current: {
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  },
}))

vi.mock('jotai-tanstack-query', () => ({
  atomWithQuery: (createOptions: (get: Getter) => QueryOptions) => atom((get) => {
    const options = createOptions(get)
    const queryName = String(options.queryKey?.[0] ?? 'unknown')
    const queryResult = options.enabled === false
      ? undefined
      : mockQueryResults.current.get(queryName)

    return {
      ...options,
      data: queryResult?.data,
      isError: false,
      isFetching: false,
      isLoading: false,
      isSuccess: Boolean(queryResult?.data),
    }
  }),
  atomWithMutation: (createOptions: () => MutationOptions) => atom(() => {
    const options = createOptions()
    return options.mutationKey?.[0] === 'deleteAppInstance'
      ? mockDeleteMutation.current
      : mockUpdateMutation.current
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appInstanceService: {
        getAppInstance: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['getAppInstance', options.input],
          }),
        },
        updateAppInstance: {
          mutationOptions: () => ({ mutationKey: ['updateAppInstance'] }),
        },
        deleteAppInstance: {
          mutationOptions: () => ({ mutationKey: ['deleteAppInstance'] }),
        },
      },
    },
  },
}))

async function loadState() {
  return await import('../state')
}

async function mountedStore() {
  const state = await loadState()
  const store = createStore()
  const unsubscribe = store.sub(state.editDeploymentFormCanSaveAtom, () => undefined)

  store.set(state.deploymentActionAppInstanceIdHydrationAtom, 'app-instance-1')

  return {
    state,
    store,
    unsubscribe,
  }
}

function setAppInstance(overrides: Record<string, unknown> = {}) {
  mockQueryResults.current.set('getAppInstance', {
    data: {
      appInstance: {
        id: 'app-instance-1',
        displayName: 'Deployment 1',
        description: 'Initial description',
        ...overrides,
      },
    },
  })
}

describe('deployment action state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryResults.current.clear()
    mockUpdateMutation.current = {
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
    }
    mockDeleteMutation.current = {
      isPending: false,
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
    }
  })

  it('should fetch app instance data only while an action dialog is open', async () => {
    const { state, store, unsubscribe } = await mountedStore()

    expect(store.get(state.deploymentActionAppInstanceQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })

    store.set(state.editDeploymentDialogOpenAtom, true)
    expect(store.get(state.deploymentActionAppInstanceQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })

    store.set(state.editDeploymentDialogOpenAtom, false)
    store.set(state.deleteDeploymentDialogOpenAtom, true)
    expect(store.get(state.deploymentActionAppInstanceQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })

    unsubscribe()
  })

  it('should keep an edit dialog open while update is pending', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    mockUpdateMutation.current = {
      isPending: true,
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
    }
    store.set(state.editDeploymentDialogOpenAtom, true)

    store.set(state.setEditDeploymentDialogOpenAtom, false)

    expect(store.get(state.editDeploymentDialogOpenAtom)).toBe(true)

    unsubscribe()
  })

  it('should submit edited deployment metadata with trimmed values', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    const response = { appInstance: { id: 'app-instance-1' } }
    setAppInstance()
    mockUpdateMutation.current.mutateAsync.mockResolvedValue(response)
    store.set(state.editDeploymentDialogOpenAtom, true)
    store.set(state.editDeploymentNameFieldAtom, ' Deployment 2 ')
    store.set(state.editDeploymentDescriptionFieldAtom, ' Updated description ')

    const result = await store.set(state.submitEditDeploymentFormAtom)

    expect(result).toBe(true)
    expect(mockUpdateMutation.current.mutateAsync).toHaveBeenCalledWith({
      params: {
        appInstanceId: 'app-instance-1',
      },
      body: {
        appInstanceId: 'app-instance-1',
        displayName: 'Deployment 2',
        description: 'Updated description',
      },
    })

    unsubscribe()
  })

  it('should submit delete with the hydrated app instance id and caller callbacks', async () => {
    const { state, store, unsubscribe } = await mountedStore()
    const onSuccess = vi.fn()

    store.set(state.submitDeleteDeploymentInstanceAtom, { onSuccess })

    expect(mockDeleteMutation.current.mutate).toHaveBeenCalledWith(
      {
        params: {
          appInstanceId: 'app-instance-1',
        },
      },
      { onSuccess },
    )

    unsubscribe()
  })
})
