import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryAtomTestStore } from '@/test/query-atom'
import {
  dslFileAtom,
  effectiveMethodAtom,
  instanceNameAtom,
  methodAtom,
  releaseNameAtom,
  selectedAppAtom,
  stepAtom,
} from '../primitives'
import {
  dslDefaultAppNameAtom,
  dslReadErrorAtom,
  isReadingDslAtom,
  sourceAppsQueryAtom,
} from '../source'
import {
  continueFromSourceAtom,
  selectDslFileAtom,
  selectMethodAtom,
  sourceCanGoNextAtom,
} from '../workflow'

type QueryOptions = {
  enabled?: boolean
  input?: unknown
  queryKey?: readonly unknown[]
  retry?: boolean
}

type InfiniteQueryOptions = QueryOptions & {
  input?: (pageParam: number) => unknown
}

const queryOptionsMocks = vi.hoisted(() => ({
  sourceApps: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      get: {
        infiniteOptions: (options: InfiniteQueryOptions) => {
          queryOptionsMocks.sourceApps(options)

          return {
            ...options,
            queryKey: ['sourceApps'],
            queryFn: async () => ({ data: [], has_more: false, page: 1 }),
          }
        },
      },
    },
    enterprise: {
      appInstanceService: {
        listAppInstances: {
          infiniteOptions: (options: InfiniteQueryOptions) => ({
            ...options,
            queryKey: ['existingInstanceNames'],
            queryFn: async () => ({ appInstances: [], pagination: {} }),
          }),
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['instanceNameConflict'],
            queryFn: async () => ({ appInstances: [] }),
          }),
        },
      },
      environmentService: {
        listEnvironments: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['environments'],
            queryFn: async () => ({ environments: [] }),
          }),
        },
      },
      releaseService: {
        computeDeploymentOptions: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['deploymentOptions'],
            queryFn: async () => ({ options: { credentialSlots: [], envVarSlots: [] } }),
          }),
        },
        precheckRelease: {
          queryOptions: (options: QueryOptions) => ({
            ...options,
            queryKey: ['precheckRelease'],
            queryFn: async () => ({ canCreate: false, unsupportedNodes: [] }),
          }),
        },
      },
    },
  },
}))

function workflowDsl() {
  return ['app:', '  mode: workflow', '  name: Imported guide'].join('\n')
}

describe('create deployment guide state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should keep the guide on source app mode when DSL import is disabled', () => {
    const { store } = createQueryAtomTestStore()

    store.set(selectMethodAtom, 'importDsl')

    expect(store.get(methodAtom)).toBe('bindApp')
    expect(store.get(effectiveMethodAtom)).toBe('bindApp')
  })

  it('should keep source app loading enabled if stale state points to DSL import', () => {
    const { store } = createQueryAtomTestStore()

    store.set(methodAtom, 'importDsl')

    store.get(sourceAppsQueryAtom)

    expect(store.get(effectiveMethodAtom)).toBe('bindApp')
    expect(queryOptionsMocks.sourceApps).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    )
  })

  it('should continue from source app mode and auto-fill unique release metadata', () => {
    const { queryClient, store } = createQueryAtomTestStore()
    queryClient.setQueryData(['sourceApps'], {
      pages: [
        {
          data: [
            {
              id: 'source-app-1',
              name: 'Customer Service',
              mode: 'workflow',
            },
          ],
        },
      ],
      pageParams: [1],
    })
    queryClient.setQueryData(['precheckRelease'], {
      canCreate: true,
      unsupportedNodes: [],
    })
    queryClient.setQueryData(['deploymentOptions'], {
      options: {
        credentialSlots: [],
        envVarSlots: [],
      },
    })
    queryClient.setQueryData(['existingInstanceNames'], {
      pages: [
        {
          appInstances: [
            { displayName: 'Customer Service' },
            { displayName: 'Customer Service 1' },
          ],
        },
      ],
      pageParams: [1],
    })

    expect(store.get(sourceCanGoNextAtom)).toBe(true)

    store.set(continueFromSourceAtom, {
      defaultDslAppName: 'Imported DSL',
      defaultReleaseName: 'Initial Release',
    })

    expect(store.get(selectedAppAtom)).toMatchObject({
      id: 'source-app-1',
      name: 'Customer Service',
    })
    expect(store.get(instanceNameAtom)).toMatch(/^Customer Service-[a-z]{4}$/)
    expect(store.get(releaseNameAtom)).toBe('Initial Release')
    expect(store.get(stepAtom)).toBe('release')
  })

  it('should read selected DSL file content through the file content query', () => {
    const { queryClient, store } = createQueryAtomTestStore()
    const text = vi.fn().mockResolvedValue(workflowDsl())
    const file = new File([], 'workflow.yml', { type: 'text/yaml' })
    Object.defineProperty(file, 'text', { value: text })

    store.set(selectDslFileAtom, file)
    queryClient.setQueryData(
      ['createGuideDslFileContent', 1, file, file.name, file.size, file.lastModified],
      workflowDsl(),
    )

    expect(text).not.toHaveBeenCalled()
    expect(store.get(dslFileAtom)).toBe(file)
    expect(store.get(dslDefaultAppNameAtom)).toBe('Imported guide')
    expect(store.get(isReadingDslAtom)).toBe(false)
    expect(store.get(dslReadErrorAtom)).toBe(false)
  })
})
