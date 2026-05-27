import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeployReleaseMenu } from '../deploy-release-menu'

type DeleteReleaseVariables = {
  params: {
    releaseId: string
  }
}

type QueryOptionsArgs = {
  input?: unknown
  enabled?: boolean
}

const mockDeleteRelease = vi.hoisted(() =>
  vi.fn<(variables: DeleteReleaseVariables) => Promise<Record<string, never>>>(),
)
const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())
const mockEnvironmentDeployments = vi.hoisted(() => ({
  data: [] as EnvironmentDeployment[],
}))

vi.mock('@langgenius/dify-ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@langgenius/dify-ui/toast')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: mockToastSuccess,
      error: mockToastError,
    },
  }
})

vi.mock('../release-dsl-export', () => ({
  exportReleaseDsl: vi.fn(),
}))

vi.mock('@/service/client', () => {
  const createKey = (name: string) => vi.fn((args?: unknown) => [name, args])

  return {
    consoleQuery: {
      enterprise: {
        appInstanceService: {
          getAppInstance: {
            queryOptions: vi.fn((args: QueryOptionsArgs) => ({
              queryKey: ['appInstance', args.input],
              queryFn: () => Promise.resolve({ appInstance: { id: 'app-1', name: 'Demo app' } }),
              enabled: args.enabled,
            })),
            key: createKey('appInstance'),
          },
          listAppInstances: {
            key: createKey('appInstances'),
          },
        },
        deploymentService: {
          listEnvironmentDeployments: {
            queryOptions: vi.fn((args: QueryOptionsArgs) => ({
              queryKey: ['environmentDeployments', args.input],
              queryFn: () => Promise.resolve({ data: mockEnvironmentDeployments.data }),
              enabled: args.enabled,
            })),
            key: createKey('environmentDeployments'),
          },
        },
        releaseService: {
          deleteRelease: {
            mutationOptions: vi.fn(() => ({
              mutationFn: mockDeleteRelease,
            })),
          },
          getRelease: {
            key: createKey('release'),
          },
          listReleases: {
            key: createKey('releases'),
          },
        },
      },
    },
  }
})

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  })
}

function renderWithQueryClient(children: ReactNode, queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>,
  )
}

function createRelease(overrides: Partial<Release> = {}): Release & { id: string } {
  return {
    id: 'release-1',
    appInstanceId: 'app-1',
    name: 'Release 1',
    createdAt: '2026-05-27T10:00:00Z',
    ...overrides,
  }
}

describe('DeployReleaseMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnvironmentDeployments.data = []
    mockDeleteRelease.mockResolvedValue({})
  })

  // Scenario: a release with no runtime usage can be deleted after explicit confirmation.
  it('should delete release after confirmation when release is not in use', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const removeSpy = vi.spyOn(queryClient, 'removeQueries')
    const onDeleted = vi.fn()

    renderWithQueryClient(
      <DeployReleaseMenu
        appInstanceId="app-1"
        releaseId="release-1"
        releaseRows={[createRelease()]}
        onDeleted={onDeleted}
      />,
      queryClient,
    )

    await user.click(screen.getByRole('button', { name: 'deployments.versions.moreActions' }))
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'deployments.versions.deleteRelease' })).not.toHaveAttribute('aria-disabled', 'true')
    })
    await user.click(screen.getByRole('menuitem', { name: 'deployments.versions.deleteRelease' }))

    expect(screen.getByRole('heading', { name: 'deployments.versions.deleteConfirmTitle' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'deployments.versions.deleteRelease' }))

    await waitFor(() => {
      expect(mockDeleteRelease).toHaveBeenCalled()
    })
    expect(mockDeleteRelease.mock.calls[0]?.[0]).toEqual({ params: { releaseId: 'release-1' } })
    expect(invalidateSpy).toHaveBeenCalled()
    expect(removeSpy).toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('deployments.versions.deleteSuccess'))
    expect(mockToastError).not.toHaveBeenCalled()
    expect(onDeleted).toHaveBeenCalledTimes(1)
  })

  // Scenario: active or pending runtime usage mirrors the backend guard and blocks delete.
  it('should disable delete action when release is in use by an environment', async () => {
    const user = userEvent.setup()
    mockEnvironmentDeployments.data = [
      {
        appInstanceId: 'app-1',
        environment: { id: 'env-1', name: 'Production' },
        currentRelease: createRelease(),
        status: 'RUNTIME_INSTANCE_STATUS_READY',
      },
    ]

    renderWithQueryClient(
      <DeployReleaseMenu
        appInstanceId="app-1"
        releaseId="release-1"
        releaseRows={[createRelease()]}
      />,
      createQueryClient(),
    )

    await user.click(screen.getByRole('button', { name: 'deployments.versions.moreActions' }))

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'deployments.versions.deleteRelease' })).toHaveAttribute('aria-disabled', 'true')
    })

    await user.click(screen.getByRole('menuitem', { name: 'deployments.versions.deleteRelease' }))

    expect(screen.queryByRole('heading', { name: 'deployments.versions.deleteConfirmTitle' })).not.toBeInTheDocument()
    expect(mockDeleteRelease).not.toHaveBeenCalled()
  })
})
