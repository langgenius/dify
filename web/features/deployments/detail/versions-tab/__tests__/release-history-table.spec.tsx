import type { EnvironmentDeployment, ReleaseRow } from '@dify/contracts/enterprise/types.gen'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReleaseHistoryTable } from '../release-history-table'

const mockUseQuery = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useQuery: (options: { queryKey?: string[] }) => mockUseQuery(options),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: () => '9 days ago',
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appInstanceService: {
        getAppInstanceOverview: {
          queryOptions: () => ({ queryKey: ['app-instance-overview'] }),
        },
      },
      appReleaseService: {
        listReleases: {
          queryOptions: () => ({ queryKey: ['release-history'] }),
        },
      },
      appDeploymentService: {
        listEnvironmentDeployments: {
          queryOptions: () => ({ queryKey: ['runtime-instances'] }),
        },
      },
    },
  },
}))

function release(overrides: Partial<ReleaseRow> = {}): ReleaseRow {
  return {
    id: 'release-1',
    name: 'R-001',
    createdAt: '2026-05-05T10:00:00Z',
    createdBy: { name: 'App-runner-demo' },
    deployedTo: [
      {
        environmentId: 'env-1',
        environmentName: 'default',
      },
    ],
    ...overrides,
  }
}

function runtimeInstance(overrides: Partial<EnvironmentDeployment> = {}): EnvironmentDeployment {
  return {
    runtime: { runtimeInstanceId: 'runtime-1' },
    environment: { id: 'env-1', name: 'default' },
    status: 'ready',
    currentRelease: { id: 'release-1' },
    ...overrides,
  }
}

describe('ReleaseHistoryTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockImplementation((options: { queryKey?: string[] }) => {
      switch (options.queryKey?.[0]) {
        case 'app-instance-overview':
          return {
            data: { overview: { appInstance: { sourceAppAvailable: true } } },
            isLoading: false,
            isError: false,
          }
        case 'release-history':
          return {
            data: {
              data: [release()],
              pagination: { totalCount: 1 },
            },
            isLoading: false,
            isError: false,
          }
        case 'runtime-instances':
          return {
            data: { data: [runtimeInstance()] },
            isLoading: false,
            isError: false,
          }
        default:
          return {
            data: undefined,
            isLoading: false,
            isError: false,
          }
      }
    })
  })

  // The desktop release history should use the same compact table shell as knowledge documents.
  describe('Rendering', () => {
    it('should render the desktop release history as a compact document-style table', () => {
      // Arrange & Act
      const { container } = render(<ReleaseHistoryTable appInstanceId="instance-1" />)

      // Assert
      const table = screen.getByRole('table')
      expect(table).toHaveClass('border-collapse', 'border-0', 'text-sm', 'min-w-[700px]')
      expect(container.querySelector('thead')).toHaveClass(
        'h-8',
        'border-b',
        'border-divider-subtle',
        'text-xs',
        'leading-8',
        'font-medium',
        'text-text-tertiary',
        'uppercase',
      )
      expect(container.querySelector('tbody tr')).toHaveClass(
        'h-8',
        'border-b',
        'border-divider-subtle',
        'hover:bg-background-default-hover',
      )
    })
  })
})
