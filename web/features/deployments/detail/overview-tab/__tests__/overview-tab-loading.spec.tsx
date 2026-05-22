import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OverviewTab } from '../../overview-tab'

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
  useQuery: (options: QueryOptions) => mockUseQuery(options),
}))

vi.mock('@/next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode, href: string, className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appInstanceService: {
        getAppInstance: {
          queryOptions: () => ({ queryKey: ['app-instance'] }),
        },
      },
      deploymentService: {
        listEnvironmentDeployments: {
          queryOptions: () => ({ queryKey: ['runtime-instances'] }),
        },
      },
      releaseService: {
        listReleases: {
          queryOptions: () => ({ queryKey: ['release-history'] }),
        },
      },
      accessService: {
        getAccessChannels: {
          queryOptions: () => ({ queryKey: ['access-channels'] }),
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

function completeOverviewData() {
  return {
    appInstance: { id: 'instance-1' },
  }
}

function releaseHistoryData() {
  return {
    data: [],
    pagination: { totalCount: 0 },
  }
}

function runtimeInstancesData() {
  return {
    data: [],
  }
}

function expectCompleteLoadingSkeleton(container: HTMLElement) {
  expect(screen.getByRole('heading', { name: 'deployments.overview.recentReleases' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'deployments.overview.strip.title' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'deployments.overview.accessStatus' })).toBeInTheDocument()
  expect(container.querySelectorAll('[data-slot="deployment-overview-release-hero-skeleton"]')).toHaveLength(1)
  expect(container.querySelectorAll('[data-slot="deployment-overview-environment-tile-skeleton"]')).toHaveLength(4)
  expect(container.querySelectorAll('[data-slot="deployment-overview-access-card-skeleton"]')).toHaveLength(3)
}

describe('OverviewTab loading states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Initial page loading should reserve space for every section in the updated overview.
  describe('Initial loading', () => {
    it('should render the complete overview skeleton when the instance overview is loading', () => {
      // Arrange
      mockUseQuery.mockImplementation((options: QueryOptions) => {
        switch (options.queryKey?.[0]) {
          case 'app-instance':
            return queryResult({ isLoading: true })
          case 'runtime-instances':
            return queryResult({ data: runtimeInstancesData() })
          case 'release-history':
            return queryResult({ data: releaseHistoryData() })
          case 'access-channels':
            return queryResult({ data: { accessChannels: { webAppEnabled: false, developerApiEnabled: false } } })
          default:
            return queryResult()
        }
      })

      // Act
      const { container } = render(<OverviewTab appInstanceId="instance-1" />)

      // Assert
      expectCompleteLoadingSkeleton(container)
    })
  })

  // Release loading happens after the instance resolves and should still align with the full page layout.
  describe('Release loading', () => {
    it('should render the complete overview skeleton when release history is loading', () => {
      // Arrange
      mockUseQuery.mockImplementation((options: QueryOptions) => {
        switch (options.queryKey?.[0]) {
          case 'app-instance':
            return queryResult({ data: completeOverviewData() })
          case 'runtime-instances':
            return queryResult({ data: runtimeInstancesData() })
          case 'release-history':
            return queryResult({ isLoading: true })
          case 'access-channels':
            return queryResult({ data: { accessChannels: { webAppEnabled: false, developerApiEnabled: false } } })
          default:
            return queryResult()
        }
      })

      // Act
      const { container } = render(<OverviewTab appInstanceId="instance-1" />)

      // Assert
      expectCompleteLoadingSkeleton(container)
    })
  })
})
