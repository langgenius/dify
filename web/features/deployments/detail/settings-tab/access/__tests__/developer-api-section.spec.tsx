import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeveloperApiSection } from '../developer-api-section'

type QueryOptions = {
  queryKey?: string[]
}

type QueryResult = {
  data?: unknown
  isLoading: boolean
  isError: boolean
}

const mockUseQuery = vi.fn<(options: QueryOptions) => QueryResult>()

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn() }),
  useQuery: (options: QueryOptions) => mockUseQuery(options),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appDeployAccessService: {
        createDeveloperApiKey: {
          mutationOptions: () => ({ mutationFn: vi.fn() }),
        },
        deleteDeveloperApiKey: {
          mutationOptions: () => ({ mutationFn: vi.fn() }),
        },
        getAppInstanceAccess: {
          queryOptions: () => ({ queryKey: ['app-instance-access'] }),
        },
        updateDeveloperApi: {
          mutationOptions: () => ({ mutationFn: vi.fn() }),
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

describe('DeveloperApiSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Loading should reserve the same shape as the enabled API page: endpoint copy row plus API key table.
  describe('Loading state', () => {
    it('should render the updated API tab skeleton while access config is loading', () => {
      // Arrange
      mockUseQuery.mockReturnValue(queryResult({ isLoading: true }))

      // Act
      const { container } = render(<DeveloperApiSection appInstanceId="instance-1" />)

      // Assert
      expect(screen.getByText('deployments.access.api.endpoint')).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'deployments.access.api.table.name' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'deployments.access.api.table.environment' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'deployments.access.api.table.key' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'deployments.access.api.table.action' })).toBeInTheDocument()
      expect(container.querySelectorAll('[data-slot="deployment-developer-api-skeleton"]')).toHaveLength(1)
      expect(container.querySelectorAll('[data-slot="deployment-developer-api-desktop-row-skeleton"]')).toHaveLength(2)
      expect(container.querySelectorAll('[data-slot="deployment-developer-api-mobile-row-skeleton"]')).toHaveLength(2)
    })
  })
})
