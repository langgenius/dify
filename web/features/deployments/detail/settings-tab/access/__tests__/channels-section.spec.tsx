import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessChannelsSection } from '../channels-section'

type QueryOptions = {
  queryKey?: string[]
}

type QueryResult = {
  data?: unknown
  isLoading: boolean
  isError: boolean
}

const mockUseQuery = vi.fn<(options: QueryOptions) => QueryResult>()
let mockUpdateAccessChannelsPending = false

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: mockUpdateAccessChannelsPending,
  }),
  useQuery: (options: QueryOptions) => mockUseQuery(options),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      accessService: {
        getAccessChannels: {
          queryOptions: () => ({ queryKey: ['access-channels'] }),
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

describe('AccessChannelsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateAccessChannelsPending = false
    mockUseQuery.mockImplementation((options: QueryOptions) => {
      switch (options.queryKey?.[0]) {
        case 'access-channels':
          return queryResult({ data: { accessChannels: { webAppEnabled: false } } })
        case 'environment-deployments':
          return queryResult({ data: { data: [] } })
        default:
          return queryResult()
      }
    })
  })

  it('should show loading feedback on the access channel switch while toggling', () => {
    // Arrange
    mockUpdateAccessChannelsPending = true

    // Act
    const { container } = render(<AccessChannelsSection appInstanceId="instance-1" />)

    // Assert
    const switchElement = screen.getByRole('switch')
    expect(switchElement).toHaveAttribute('aria-busy', 'true')
    expect(switchElement).toHaveAttribute('data-disabled', '')
    expect(container.querySelector('.i-ri-loader-2-line')).toBeInTheDocument()
  })
})
