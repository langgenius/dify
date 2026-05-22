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

  // The desktop release history should use the shared semantic deployment detail table.
  describe('Rendering', () => {
    it('should render the desktop release history with the shared detail table design', () => {
      // Arrange & Act
      const { container } = render(<ReleaseHistoryTable appInstanceId="instance-1" />)

      // Assert
      const desktopWrapper = container.querySelector('.hidden.pc\\:block')
      const tableContainer = desktopWrapper?.querySelector('[data-slot="deployment-detail-table-container"]')
      const tableShell = desktopWrapper?.querySelector('[data-slot="deployment-detail-table"]')
      const header = tableShell?.querySelector('[data-slot="deployment-detail-table-header"]')
      const body = tableShell?.querySelector('[data-slot="deployment-detail-table-body"]')
      const row = body?.querySelector('[data-slot="deployment-detail-table-row"]')
      const head = header?.querySelector('[data-slot="deployment-detail-table-head"]')
      const cell = row?.querySelector('[data-slot="deployment-detail-table-cell"]')

      expect(tableContainer).toHaveClass(
        'overflow-hidden',
        'rounded-lg',
        'border',
        'border-divider-subtle',
        'bg-background-default',
      )
      expect(tableShell?.tagName).toBe('TABLE')
      expect(header?.tagName).toBe('THEAD')
      expect(body?.tagName).toBe('TBODY')
      expect(row?.tagName).toBe('TR')
      expect(head?.tagName).toBe('TH')
      expect(cell?.tagName).toBe('TD')
      expect(tableShell).toHaveClass(
        'w-full',
        'table-fixed',
        'border-collapse',
        'caption-bottom',
      )
      expect(head).toHaveClass(
        'h-9',
        'px-4',
        'py-2',
        'system-sm-medium-uppercase',
        'text-text-tertiary',
      )
      expect(row).toHaveClass(
        'border-b',
        'border-divider-subtle',
        'hover:bg-background-default-hover',
      )
      expect(cell).toHaveClass(
        'h-12',
        'min-w-0',
        'px-4',
        'py-2',
      )
      expect(row?.querySelector('[data-slot="deployment-detail-table-row-content"]')).toBeNull()
      expect(screen.getAllByText('R-001')).toHaveLength(2)
    })
  })
})
