import { screen, render as testingLibraryRender, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider, useAtomValue, useSetAtom } from 'jotai'
import { createQueryAtomTestStore } from '@/test/query-atom'
import {
  addPublisherEnvironmentAtom,
  appPublisherEnvironmentsAtom,
  AppPublisherStateBoundary,
  joinedPublisherEnvironmentIdsAtom,
  selectedEnvironmentDeploymentAtom,
  selectedPublisherEnvironmentIdAtom,
} from '../state'

type QueryOptions = {
  enabled?: boolean
  input: unknown
}

const queryMocks = vi.hoisted(() => ({
  deploymentOptions: vi.fn(),
  deploymentRequest: vi.fn(),
  environmentOptions: vi.fn(),
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
            listAppEnvironments: {
              queryOptions: (options: QueryOptions) => {
                queryMocks.environmentOptions(options)

                return {
                  ...options,
                  queryFn: async () => ({
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
                        in_use: false,
                        status: 'ENVIRONMENT_STATUS_READY',
                      },
                    ],
                  }),
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
  const environments = useAtomValue(appPublisherEnvironmentsAtom)
  const joinedEnvironmentIds = useAtomValue(joinedPublisherEnvironmentIdsAtom)
  const selectedEnvironmentId = useAtomValue(selectedPublisherEnvironmentIdAtom)
  const deployment = useAtomValue(selectedEnvironmentDeploymentAtom)
  const addEnvironment = useSetAtom(addPublisherEnvironmentAtom)
  const selectEnvironment = useSetAtom(selectedPublisherEnvironmentIdAtom)

  return (
    <>
      <div>{`Environments: ${environments.map((environment) => environment.display_name).join(', ')}`}</div>
      <div>{`Joined: ${joinedEnvironmentIds.join(', ')}`}</div>
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
    </>
  )
}

function renderState() {
  const { store } = createQueryAtomTestStore()

  return testingLibraryRender(
    <Provider store={store}>
      <AppPublisherStateBoundary appId="app-1" environmentQueryEnabled>
        <StateConsumer />
      </AppPublisherStateBoundary>
    </Provider>,
  )
}

describe('app publisher environment state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(queryMocks.deploymentRequest).not.toHaveBeenCalled()
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
})
