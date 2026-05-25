import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeveloperApiHeaderActions, DeveloperApiHeaderSwitch, DeveloperApiSection } from '../developer-api-section'

type QueryOptions = {
  queryKey?: string[]
}

type QueryResult = {
  data?: unknown
  isLoading: boolean
  isError: boolean
}

type MutationOptions = {
  mutationKey?: string[]
}

const mockUseQuery = vi.fn<(options: QueryOptions) => QueryResult>()
let mockUpdateAccessChannelsPending = false

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: MutationOptions) => ({
    mutate: vi.fn((_variables: unknown, callbacks?: { onSuccess?: (response: { token?: string }) => void }) => {
      if (options.mutationKey?.[0] === 'create-api-key')
        callbacks?.onSuccess?.({ token: 'app-created-token' })
    }),
    isPending: options.mutationKey?.[0] === 'update-access-channels'
      ? mockUpdateAccessChannelsPending
      : false,
  }),
  useQueries: () => [],
  useQuery: (options: QueryOptions) => mockUseQuery(options),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      accessService: {
        createApiKey: {
          mutationOptions: () => ({ mutationKey: ['create-api-key'] }),
        },
        deleteApiKey: {
          mutationOptions: () => ({ mutationKey: ['delete-api-key'] }),
        },
        getAccessChannels: {
          queryOptions: () => ({ queryKey: ['access-channels'] }),
        },
        listApiKeys: {
          queryOptions: () => ({ queryKey: ['api-keys'] }),
        },
        updateAccessChannels: {
          mutationOptions: () => ({ mutationKey: ['update-access-channels'] }),
        },
      },
      deploymentService: {
        listEnvironmentDeployments: {
          queryOptions: () => ({ queryKey: ['environment-deployments'] }),
        },
      },
    },
  },
}))

function queryResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    ...overrides,
  }
}

function renderWithJotai(node: ReactNode) {
  return render(
    <JotaiProvider store={createStore()}>
      {node}
    </JotaiProvider>,
  )
}

describe('DeveloperApiSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateAccessChannelsPending = false
  })

  describe('Header switch', () => {
    it('should show loading feedback while toggling developer API access', () => {
      // Arrange
      mockUpdateAccessChannelsPending = true
      mockUseQuery.mockReturnValue(queryResult({ data: { accessChannels: { developerApiEnabled: false } } }))

      // Act
      const { container } = render(<DeveloperApiHeaderSwitch appInstanceId="instance-1" />)

      // Assert
      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveAttribute('aria-busy', 'true')
      expect(switchElement).toHaveAttribute('data-disabled', '')
      expect(container.querySelector('.i-ri-loader-2-line')).toBeInTheDocument()
    })
  })

  // Loading should reserve the same shape as the enabled API key list.
  describe('Loading state', () => {
    it('should render the updated API tab skeleton while access config is loading', () => {
      // Arrange
      mockUseQuery.mockReturnValue(queryResult({ isLoading: true }))

      // Act
      const { container } = render(<DeveloperApiSection appInstanceId="instance-1" />)

      // Assert
      expect(screen.queryByText('deployments.access.api.endpoint')).not.toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'deployments.access.api.table.name' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'deployments.access.api.table.environment' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'deployments.access.api.table.key' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'deployments.access.api.table.action' })).toBeInTheDocument()
      expect(container.querySelectorAll('[data-slot="deployment-developer-api-skeleton"]')).toHaveLength(1)
      expect(container.querySelectorAll('[data-slot="deployment-developer-api-desktop-row-skeleton"]')).toHaveLength(2)
      expect(container.querySelectorAll('[data-slot="deployment-developer-api-mobile-row-skeleton"]')).toHaveLength(2)
    })
  })

  // The newly created token should block in a confirmation dialog because the raw token is shown only once.
  describe('Created API token dialog', () => {
    it('should show the generated token in a confirmation dialog after creating an API key', async () => {
      // Arrange
      mockUseQuery.mockImplementation((options: QueryOptions) => {
        switch (options.queryKey?.[0]) {
          case 'access-channels':
            return queryResult({ data: { accessChannels: { developerApiEnabled: true } } })
          case 'environment-deployments':
            return queryResult({
              data: {
                data: [
                  {
                    environment: {
                      id: 'env-1',
                      name: 'Production',
                    },
                  },
                ],
              },
            })
          default:
            return queryResult()
        }
      })

      renderWithJotai(
        <>
          <DeveloperApiHeaderActions appInstanceId="instance-1" />
          <DeveloperApiSection appInstanceId="instance-1" />
        </>,
      )

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'deployments.access.api.newKey' }))
      fireEvent.click(screen.getByText('deployments.access.api.newKeyForEnv:{"env":"Production"}'))

      // Assert
      const dialog = await screen.findByRole('dialog', { name: 'deployments.access.api.newTokenTitle' })
      expect(within(dialog).getByText('deployments.access.api.newTokenDescription')).toBeInTheDocument()
      expect(within(dialog).getByText('app-created-token')).toBeInTheDocument()

      fireEvent.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'deployments.access.api.newTokenTitle' })).not.toBeInTheDocument()
      })
    })
  })
})
