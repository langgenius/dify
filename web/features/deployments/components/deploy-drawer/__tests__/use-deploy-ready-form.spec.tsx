import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deployDrawerOpenAtom } from '../../../store'
import {
  deployReadyFormConfigAtom,
  deployReadyFormLocalAtoms,
  useDeployReleaseSubmission,
} from '../use-deploy-ready-form'

type MutationCallbackOptions = {
  onError?: (...args: unknown[]) => unknown
  onSuccess?: (...args: unknown[]) => unknown
}

const mocks = vi.hoisted(() => ({
  mutateCalls: [] as Array<{
    options: MutationCallbackOptions
    perCallOptions?: MutationCallbackOptions
    variables: unknown
  }>,
  promoteBaseOnSuccess: vi.fn(),
  rollbackBaseOnSuccess: vi.fn(),
  toastError: vi.fn(),
  useMutation: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useMutation: mocks.useMutation,
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      deploymentService: {
        promote: {
          mutationOptions: () => ({
            onSuccess: mocks.promoteBaseOnSuccess,
          }),
        },
        rollback: {
          mutationOptions: () => ({
            onSuccess: mocks.rollbackBaseOnSuccess,
          }),
        },
      },
    },
  },
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: mocks.toastError,
  },
}))

function release(id: string, createdAt: string): Release {
  return {
    id,
    createdAt,
  }
}

function runtimeRow(currentRelease: Release): EnvironmentDeployment {
  return {
    environment: {
      id: 'env-1',
      name: 'Production',
    },
    currentRelease,
  }
}

describe('useDeployReleaseSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mutateCalls = []
    mocks.useMutation.mockImplementation((options: MutationCallbackOptions) => ({
      isPending: false,
      mutate: vi.fn((variables: unknown, perCallOptions?: MutationCallbackOptions) => {
        mocks.mutateCalls.push({ options, perCallOptions, variables })
        options.onSuccess?.({}, variables, undefined, {})
        perCallOptions?.onSuccess?.({}, variables, undefined, {})
      }),
    }))
  })

  // Deployment success should close the outer drawer store while form atoms stay scoped.
  describe('Deployment success', () => {
    it('should close the parent deploy drawer from inside the scoped form store', async () => {
      const store = createStore()
      const currentRelease = release('release-current', '2026-01-01T00:00:00.000Z')
      const targetRelease = release('release-target', '2026-01-02T00:00:00.000Z')
      const config = {
        appInstanceId: 'app-instance-1',
        defaultReleaseId: targetRelease.id,
        environments: [{
          id: 'env-1',
          name: 'Production',
        }],
        releases: [targetRelease, currentRelease],
        runtimeRows: [runtimeRow(currentRelease)],
      }
      store.set(deployDrawerOpenAtom, true)
      const wrapper = ({ children }: { children: ReactNode }) => (
        <JotaiProvider store={store}>
          <ScopeProvider
            atoms={[
              [deployReadyFormConfigAtom, config],
              ...deployReadyFormLocalAtoms,
            ]}
          >
            {children}
          </ScopeProvider>
        </JotaiProvider>
      )
      const { result } = renderHook(() => useDeployReleaseSubmission({
        deploymentCredentials: [],
        deploymentEnvVars: [],
      }), { wrapper })

      await act(async () => {
        result.current.deployRelease()
      })

      expect(mocks.mutateCalls).toHaveLength(1)
      expect(mocks.promoteBaseOnSuccess).toHaveBeenCalledTimes(1)
      expect(store.get(deployDrawerOpenAtom)).toBe(false)
    })
  })
})
