import {
  DeploymentOperationStatus,
  DeploymentStatus,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, render as testingLibraryRender, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider, useAtomValue, useSetAtom } from 'jotai'
import { createQueryAtomTestStore } from '@/test/query-atom'
import { useRefreshAppEnvironmentsAfterPublisherDeploymentPolling } from '../hooks/use-refresh-app-environments-after-deployment-polling'
import {
  addPublisherEnvironmentAtom,
  appPublisherEnvironmentsAtom,
  appPublisherOpenAtom,
  AppPublisherStateBoundary,
  joinedPublisherEnvironmentIdsAtom,
  publisherEnvironmentDeploymentPollingAtom,
  selectedEnvironmentDeploymentAtom,
  selectedPublisherEnvironmentIdAtom,
  startPublisherEnvironmentDeploymentPollingAtom,
} from '../state'

type QueryOptions = {
  enabled?: boolean
  input: unknown
  refetchInterval?: (query: {
    state: {
      data?: {
        environment_deployment: {
          deployment?: {
            latest_operation?: {
              id: string
              status: string
            }
            status: string
          }
        }
      }
      fetchFailureCount?: number
      status?: 'error' | 'pending' | 'success'
    }
  }) => false | number
}

const queryMocks = vi.hoisted(() => ({
  deploymentListOptions: vi.fn(),
  deploymentListRequest: vi.fn(),
  deploymentOptions: vi.fn(),
  deploymentRequest: vi.fn(),
  environmentOptions: vi.fn(),
  environmentRequest: vi.fn(),
}))

vi.mock('@/service/client', async () => {
  const { skipToken } = await import('@tanstack/react-query')

  return {
    consoleQuery: {
      enterprise: {
        appDeploy: {
          deploymentService: {
            getEnvironmentDeployment: {
              queryOptions: (options: QueryOptions) => {
                queryMocks.deploymentOptions(options)
                const environmentId =
                  typeof options.input === 'object' && options.input
                    ? (options.input as { params: { environment_id: string } }).params
                        .environment_id
                    : 'disabled'

                return {
                  ...options,
                  queryFn:
                    options.input === skipToken
                      ? skipToken
                      : () => queryMocks.deploymentRequest(options.input),
                  queryKey: ['publisherEnvironmentDeployment', environmentId],
                }
              },
            },
            listEnvironmentDeployments: {
              queryOptions: (options: QueryOptions) => {
                queryMocks.deploymentListOptions(options)

                return {
                  ...options,
                  queryFn:
                    options.input === skipToken
                      ? skipToken
                      : () => queryMocks.deploymentListRequest(options.input),
                  queryKey: ['publisherEnvironmentDeployments'],
                }
              },
            },
            listAppEnvironments: {
              queryOptions: (options: QueryOptions) => {
                queryMocks.environmentOptions(options)

                return {
                  ...options,
                  queryFn: () => queryMocks.environmentRequest(),
                  queryKey: ['publisherEnvironments'],
                }
              },
            },
          },
        },
      },
    },
  }
})

function StateConsumer() {
  useRefreshAppEnvironmentsAfterPublisherDeploymentPolling('app-1')
  const environments = useAtomValue(appPublisherEnvironmentsAtom)
  const open = useAtomValue(appPublisherOpenAtom)
  const joinedEnvironmentIds = useAtomValue(joinedPublisherEnvironmentIdsAtom)
  const polling = useAtomValue(publisherEnvironmentDeploymentPollingAtom)
  const selectedEnvironmentId = useAtomValue(selectedPublisherEnvironmentIdAtom)
  const deployment = useAtomValue(selectedEnvironmentDeploymentAtom)
  const addEnvironment = useSetAtom(addPublisherEnvironmentAtom)
  const setOpen = useSetAtom(appPublisherOpenAtom)
  const selectEnvironment = useSetAtom(selectedPublisherEnvironmentIdAtom)
  const startDeploymentPolling = useSetAtom(startPublisherEnvironmentDeploymentPollingAtom)
  const development = environments.find((environment) => environment.id === 'development')

  return (
    <>
      <div>{`Environments: ${environments.map((environment) => environment.display_name).join(', ')}`}</div>
      <div>{`Joined: ${joinedEnvironmentIds.join(', ')}`}</div>
      <div>{`Development in use: ${String(development?.in_use)}`}</div>
      <div>{`Polling: ${polling?.operationId ?? 'none'}`}</div>
      <div>{`Open: ${String(open)}`}</div>
      <div>{`Selected: ${selectedEnvironmentId}`}</div>
      <div>
        {`Deployment: ${
          deployment?.deployment?.current_version?.marked_name ??
          deployment?.deployment?.current_version?.version ??
          'none'
        }`}
      </div>
      <button type="button" onClick={() => addEnvironment('development')}>
        Add development
      </button>
      <button type="button" onClick={() => selectEnvironment('staging')}>
        Select staging
      </button>
      <button type="button" onClick={() => selectEnvironment('development')}>
        Select development
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Close publisher
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        Open publisher
      </button>
      <button
        type="button"
        onClick={() =>
          startDeploymentPolling({
            environmentId: 'development',
            operationId: 'operation-development',
          })
        }
      >
        Start development deployment
      </button>
      <button
        type="button"
        onClick={() =>
          startDeploymentPolling({
            environmentId: 'staging',
            operationId: 'operation-staging',
          })
        }
      >
        Start staging deployment
      </button>
    </>
  )
}

function renderState(initialOpen = true) {
  const { queryClient, store } = createQueryAtomTestStore()
  store.set(appPublisherOpenAtom, initialOpen)
  const state = (mounted: boolean) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        {mounted && (
          <AppPublisherStateBoundary appId="app-1" environmentQueryEnabled>
            <StateConsumer />
          </AppPublisherStateBoundary>
        )}
      </Provider>
    </QueryClientProvider>
  )
  const rendered = testingLibraryRender(state(true))

  return {
    ...rendered,
    queryClient,
    rerenderWithMounted: (mounted: boolean) => rendered.rerender(state(mounted)),
  }
}

function environmentDeploymentResponse({
  deploymentStatus,
  operationId,
  operationStatus,
}: {
  deploymentStatus: string
  operationId: string
  operationStatus: string
}) {
  return {
    environment_deployment: {
      access: {
        enable_api: true,
        enable_site: true,
      },
      deployment: {
        current_version:
          deploymentStatus === DeploymentStatus.DEPLOYMENT_STATUS_RUNNING
            ? {
                id: 'version-development',
                marked_comment: '',
                marked_name: 'Release development',
                version: '2026-07-31.development',
              }
            : undefined,
        latest_operation: {
          activity_at: 1_785_456_000,
          id: operationId,
          operator: {
            display_name: 'Evan',
            id: 'user-1',
            type: 'OPERATOR_TYPE_ACCOUNT',
          },
          status: operationStatus,
          type: 'DEPLOYMENT_OPERATION_TYPE_DEPLOY',
        },
        status: deploymentStatus,
      },
      environment: {
        description: '',
        display_name: 'Development',
        id: 'development',
        status: 'ENVIRONMENT_STATUS_READY',
      },
    },
  }
}

const appEnvironments = (developmentInUse: boolean) => ({
  data: [
    {
      description: '',
      display_name: 'Staging',
      id: 'staging',
      in_use: true,
      status: 'ENVIRONMENT_STATUS_READY',
    },
    {
      description: '',
      display_name: 'Development',
      id: 'development',
      in_use: developmentInUse,
      status: 'ENVIRONMENT_STATUS_READY',
    },
  ],
})

function getDeploymentQueryOptions(environmentId: string) {
  return queryMocks.deploymentOptions.mock.calls
    .map(([options]) => options as QueryOptions)
    .reverse()
    .find((options) => {
      if (typeof options.input !== 'object' || !options.input) return false

      return (
        (options.input as { params?: { environment_id?: string } }).params?.environment_id ===
        environmentId
      )
    })
}

function getLatestDeploymentQueryOptions() {
  return queryMocks.deploymentOptions.mock.calls.at(-1)?.[0] as QueryOptions | undefined
}

function getDeploymentRequestCount(environmentId: string) {
  return queryMocks.deploymentRequest.mock.calls.filter((call) => {
    const input = call[0] as { params: { environment_id: string } }
    return input.params.environment_id === environmentId
  }).length
}

describe('app publisher environment state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryMocks.deploymentListRequest.mockResolvedValue({
      environment_deployments: [],
    })
    queryMocks.environmentRequest.mockResolvedValue(appEnvironments(false))
    queryMocks.deploymentRequest.mockImplementation(
      async (input: { params: { environment_id: string } }) => ({
        environment_deployment: {
          access: {
            enable_api: true,
            enable_site: true,
          },
          deployment: {
            current_version: {
              id: `version-${input.params.environment_id}`,
              marked_comment: '',
              marked_name: `Release ${input.params.environment_id}`,
              version: `2026-07-31.${input.params.environment_id}`,
            },
            status: 'DEPLOYMENT_STATUS_RUNNING',
          },
          environment: {
            description: '',
            display_name: input.params.environment_id,
            id: input.params.environment_id,
            status: 'ENVIRONMENT_STATUS_READY',
          },
        },
      }),
    )
  })

  it('derives deployed tabs from the environment in_use field', async () => {
    const user = userEvent.setup()
    renderState()

    expect(await screen.findByText('Joined: staging')).toBeInTheDocument()
    expect(screen.getByText('Environments: Staging, Development')).toBeInTheDocument()
    expect(queryMocks.environmentOptions).toHaveBeenCalledWith({
      enabled: true,
      input: {
        params: {
          app_id: 'app-1',
        },
      },
    })

    await user.click(screen.getByRole('button', { name: 'Add development' }))

    expect(screen.getByText('Joined: staging, development')).toBeInTheDocument()
    expect(screen.getByText('Selected: development')).toBeInTheDocument()
    await waitFor(() => {
      expect(queryMocks.deploymentListRequest).toHaveBeenCalledWith({
        params: {
          app_id: 'app-1',
        },
      })
    })
    expect(queryMocks.deploymentRequest).not.toHaveBeenCalled()
  })

  it('discovers and resumes polling a first deployment while the environment remains not in use', async () => {
    const user = userEvent.setup()
    const response = environmentDeploymentResponse({
      deploymentStatus: DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING,
      operationId: 'operation-development',
      operationStatus: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
    })
    queryMocks.deploymentListRequest.mockResolvedValue({
      environment_deployments: [response.environment_deployment],
    })
    queryMocks.deploymentRequest.mockResolvedValue(response)
    renderState()

    expect(await screen.findByText('Development in use: false')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add development' }))

    await waitFor(() => {
      expect(queryMocks.deploymentRequest).toHaveBeenCalledWith({
        params: {
          app_id: 'app-1',
          environment_id: 'development',
        },
      })
    })
    expect(
      getDeploymentQueryOptions('development')?.refetchInterval?.({
        state: {
          data: response,
        },
      }),
    ).toBe(3000)
  })

  it('stops automatic status polling while the deployment query is failing', async () => {
    const user = userEvent.setup()
    const response = environmentDeploymentResponse({
      deploymentStatus: DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING,
      operationId: 'operation-staging',
      operationStatus: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
    })
    renderState()

    await screen.findByText('Joined: staging')
    await user.click(screen.getByRole('button', { name: 'Select staging' }))

    const refetchInterval = getDeploymentQueryOptions('staging')?.refetchInterval
    expect(refetchInterval).toBeTypeOf('function')
    expect(
      refetchInterval?.({
        state: {
          data: response,
          fetchFailureCount: 1,
          status: 'success',
        },
      }),
    ).toBe(false)
    expect(
      refetchInterval?.({
        state: {
          data: response,
          status: 'error',
        },
      }),
    ).toBe(false)
  })

  it('queries deployment details only after selecting an in-use non-built-in environment', async () => {
    const user = userEvent.setup()
    renderState()

    await screen.findByText('Joined: staging')
    expect(queryMocks.deploymentRequest).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Select staging' }))

    await waitFor(() => {
      expect(queryMocks.deploymentRequest).toHaveBeenCalledWith({
        params: {
          app_id: 'app-1',
          environment_id: 'staging',
        },
      })
    })
    expect(await screen.findByText('Deployment: Release staging')).toBeInTheDocument()
  })

  it('resets the selected environment to built-in when the publisher reopens', async () => {
    const user = userEvent.setup()
    renderState()

    await screen.findByText('Joined: staging')
    await user.click(screen.getByRole('button', { name: 'Select staging' }))
    expect(screen.getByText('Selected: staging')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close publisher' }))
    await user.click(screen.getByRole('button', { name: 'Open publisher' }))

    expect(screen.getByText('Selected: built-in')).toBeInTheDocument()
  })

  it('refreshes environments when a selected deployment has succeeded', async () => {
    const user = userEvent.setup()
    queryMocks.environmentRequest
      .mockResolvedValueOnce(appEnvironments(false))
      .mockResolvedValue(appEnvironments(true))
    queryMocks.deploymentRequest.mockResolvedValue(
      environmentDeploymentResponse({
        deploymentStatus: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
        operationId: 'operation-development',
        operationStatus: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED,
      }),
    )
    renderState()

    expect(await screen.findByText('Development in use: false')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add development' }))
    expect(queryMocks.deploymentRequest).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Start development deployment' }))

    await waitFor(() => {
      expect(queryMocks.deploymentRequest).toHaveBeenCalledWith({
        params: {
          app_id: 'app-1',
          environment_id: 'development',
        },
      })
    })
    expect(await screen.findByText('Deployment: Release development')).toBeInTheDocument()
    expect(await screen.findByText('Development in use: true')).toBeInTheDocument()
    expect(screen.getByText('Polling: none')).toBeInTheDocument()

    const deploymentQueryOptions = getDeploymentQueryOptions('development')
    expect(deploymentQueryOptions?.refetchInterval).toBeTypeOf('function')
    expect(
      deploymentQueryOptions?.refetchInterval?.({
        state: {
          data: environmentDeploymentResponse({
            deploymentStatus: DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING,
            operationId: 'operation-development',
            operationStatus: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
          }),
        },
      }),
    ).toBe(3000)
    expect(
      deploymentQueryOptions?.refetchInterval?.({
        state: {
          data: environmentDeploymentResponse({
            deploymentStatus: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
            operationId: 'operation-development',
            operationStatus: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED,
          }),
        },
      }),
    ).toBe(false)
    expect(queryMocks.environmentRequest).toHaveBeenCalledTimes(2)
  })

  it('scopes polling to the selected environment and clears it when the publisher closes', async () => {
    const user = userEvent.setup()
    queryMocks.environmentRequest.mockResolvedValue(appEnvironments(true))
    queryMocks.deploymentRequest.mockImplementation(
      async (input: { params: { environment_id: string } }) =>
        input.params.environment_id === 'staging'
          ? environmentDeploymentResponse({
              deploymentStatus: DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING,
              operationId: 'operation-staging',
              operationStatus: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
            })
          : environmentDeploymentResponse({
              deploymentStatus: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
              operationId: 'operation-development',
              operationStatus: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED,
            }),
    )
    renderState()

    await screen.findByText('Joined: staging, development')
    await user.click(screen.getByRole('button', { name: 'Select staging' }))
    await waitFor(() => {
      expect(queryMocks.deploymentRequest).toHaveBeenCalledWith({
        params: {
          app_id: 'app-1',
          environment_id: 'staging',
        },
      })
    })
    expect(
      getDeploymentQueryOptions('staging')?.refetchInterval?.({
        state: {
          data: environmentDeploymentResponse({
            deploymentStatus: DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING,
            operationId: 'operation-staging',
            operationStatus: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
          }),
        },
      }),
    ).toBe(3000)

    await user.click(screen.getByRole('button', { name: 'Start staging deployment' }))
    expect(screen.getByText('Polling: operation-staging')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select development' }))

    expect(screen.getByText('Polling: none')).toBeInTheDocument()
    await waitFor(() => {
      expect(queryMocks.deploymentRequest).toHaveBeenCalledWith({
        params: {
          app_id: 'app-1',
          environment_id: 'development',
        },
      })
    })
    expect(
      getDeploymentQueryOptions('development')?.refetchInterval?.({
        state: {
          data: environmentDeploymentResponse({
            deploymentStatus: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
            operationId: 'operation-development',
            operationStatus: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED,
          }),
        },
      }),
    ).toBe(false)

    const stagingRequestCount = getDeploymentRequestCount('staging')
    await user.click(screen.getByRole('button', { name: 'Select staging' }))
    await waitFor(() => {
      const nextStagingRequestCount = getDeploymentRequestCount('staging')
      expect(nextStagingRequestCount).toBeGreaterThan(stagingRequestCount)
    })

    await user.click(screen.getByRole('button', { name: 'Start staging deployment' }))
    await user.click(screen.getByRole('button', { name: 'Close publisher' }))

    await waitFor(() => {
      expect(screen.getByText('Polling: none')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(getLatestDeploymentQueryOptions()?.enabled).toBe(false)
    })
  })

  it('resets open state and active polling when the last publisher subscriber unmounts', async () => {
    const user = userEvent.setup()
    queryMocks.environmentRequest.mockResolvedValue(appEnvironments(true))
    queryMocks.deploymentRequest.mockResolvedValue(
      environmentDeploymentResponse({
        deploymentStatus: DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING,
        operationId: 'operation-staging',
        operationStatus: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
      }),
    )
    const { rerenderWithMounted } = renderState()

    await screen.findByText('Open: true')
    await user.click(screen.getByRole('button', { name: 'Select staging' }))
    await waitFor(() => {
      expect(queryMocks.deploymentRequest).toHaveBeenCalled()
    })
    await user.click(screen.getByRole('button', { name: 'Start staging deployment' }))
    expect(screen.getByText('Polling: operation-staging')).toBeInTheDocument()

    rerenderWithMounted(false)
    rerenderWithMounted(true)

    expect(await screen.findByText('Open: false')).toBeInTheDocument()
    expect(screen.getByText('Polling: none')).toBeInTheDocument()
    await waitFor(() => {
      expect(getLatestDeploymentQueryOptions()?.enabled).toBe(false)
    })
  })
})
