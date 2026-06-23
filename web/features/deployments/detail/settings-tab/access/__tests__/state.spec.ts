import type { Getter } from 'jotai'
import { skipToken } from '@tanstack/react-query'
import { atom, createStore } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { setNextRouteStateAtom } from '@/app/components/next-route-state/atoms'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  queryKey?: readonly unknown[]
}

type MutationOptions = {
  mutationKey?: readonly unknown[]
}

vi.mock('jotai-tanstack-query', () => ({
  atomWithQuery: (createOptions: (get: Getter) => QueryOptions) => atom(get => ({
    ...createOptions(get),
    data: undefined,
    isError: false,
    isFetching: false,
    isLoading: false,
    isSuccess: false,
  })),
  atomWithMutation: (createOptions: () => MutationOptions) => atom(() => createOptions()),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      accessService: {
        createApiKey: {
          mutationOptions: () => ({ mutationKey: ['createApiKey'] }),
        },
        deleteApiKey: {
          mutationOptions: () => ({ mutationKey: ['deleteApiKey'] }),
        },
        getAccessSettings: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['getAccessSettings', options.input],
          }),
        },
        getDeveloperApiSettings: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['getDeveloperApiSettings', options.input],
          }),
        },
        updateAccessChannels: {
          mutationOptions: () => ({ mutationKey: ['updateAccessChannels'] }),
        },
        updateAccessPolicy: {
          mutationOptions: () => ({ mutationKey: ['updateAccessPolicy'] }),
        },
      },
    },
  },
}))

async function loadState() {
  return await import('../state')
}

function setDeploymentRoute(store: ReturnType<typeof createStore>, appInstanceId = 'app-instance-1') {
  store.set(setNextRouteStateAtom, {
    pathname: `/deployments/${appInstanceId}/settings/access`,
    params: { appInstanceId },
  })
}

describe('deployment access state', () => {
  it('should gate access queries until a route app instance exists', async () => {
    const state = await loadState()
    const store = createStore()

    expect(store.get(state.accessSettingsQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })
    expect(store.get(state.developerApiSettingsQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })

    setDeploymentRoute(store)

    expect(store.get(state.accessSettingsQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
    expect(store.get(state.developerApiSettingsQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
  })

  it('should expose access mutation atoms from state', async () => {
    const state = await loadState()
    const store = createStore()
    const deleteApiKeyMutationAtom = state.createDeleteApiKeyMutationAtom()
    const updateAccessPolicyMutationAtom = state.createUpdateAccessPolicyMutationAtom()

    expect(store.get(state.updateAccessChannelsMutationAtom)).toMatchObject({
      mutationKey: ['updateAccessChannels'],
    })
    expect(store.get(state.createApiKeyMutationAtom)).toMatchObject({
      mutationKey: ['createApiKey'],
    })
    expect(store.get(deleteApiKeyMutationAtom)).toMatchObject({
      mutationKey: ['deleteApiKey'],
    })
    expect(store.get(updateAccessPolicyMutationAtom)).toMatchObject({
      mutationKey: ['updateAccessPolicy'],
    })
  })
})
