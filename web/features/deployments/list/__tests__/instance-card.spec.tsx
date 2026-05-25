import type {
  AccessChannels,
  AppInstance,
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InstanceCard } from '../instance-card'

type QueryOptions = {
  queryKey?: string[]
}

type QueryResult = {
  data?: unknown
  isLoading: boolean
  isError: boolean
}

type CardQueryData = {
  accessChannels: AccessChannels
  appInstance: AppInstance
  environmentDeployments: EnvironmentDeployment[]
  releases: Release[]
}

const mocks = vi.hoisted(() => ({
  openDeployDrawer: vi.fn(),
  useQuery: vi.fn<(options: QueryOptions) => QueryResult>(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: QueryOptions) => mocks.useQuery(options),
}))

vi.mock('jotai', async () => {
  const actual = await vi.importActual<typeof import('jotai')>('jotai')

  return {
    ...actual,
    useSetAtom: () => mocks.openDeployDrawer,
  }
})

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: () => '6 hours ago',
  }),
}))

vi.mock('@/next/link', () => ({
  default: ({ children, href, className, 'aria-label': ariaLabel }: {
    'children': React.ReactNode
    'href': string
    'className'?: string
    'aria-label'?: string
  }) => (
    <a href={href} className={className} aria-label={ariaLabel}>{children}</a>
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
      accessService: {
        getAccessChannels: {
          queryOptions: () => ({ queryKey: ['access-channels'] }),
        },
      },
      releaseService: {
        listReleases: {
          queryOptions: () => ({ queryKey: ['release-history'] }),
        },
      },
      deploymentService: {
        listEnvironmentDeployments: {
          queryOptions: () => ({ queryKey: ['runtime-instances'] }),
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

function appInstance(overrides: Partial<AppInstance> = {}): AppInstance {
  return {
    id: 'instance-1',
    name: 'Test chat',
    description: 'Test deployment instance',
    ...overrides,
  }
}

function release(overrides: Partial<Release> = {}): Release {
  return {
    id: 'release-1',
    name: 'R-001',
    createdAt: '2026-05-25T00:00:00.000Z',
    ...overrides,
  }
}

function mockCardQueries(overrides: Partial<CardQueryData> = {}) {
  const data: CardQueryData = {
    accessChannels: {
      webAppEnabled: true,
      developerApiEnabled: false,
    },
    appInstance: appInstance(),
    environmentDeployments: [],
    releases: [release()],
    ...overrides,
  }

  mocks.useQuery.mockImplementation((options: QueryOptions) => {
    switch (options.queryKey?.[0]) {
      case 'app-instance':
        return queryResult({ data: { appInstance: data.appInstance } })
      case 'access-channels':
        return queryResult({ data: { accessChannels: data.accessChannels } })
      case 'release-history':
        return queryResult({ data: { data: data.releases } })
      case 'runtime-instances':
        return queryResult({ data: { data: data.environmentDeployments } })
      default:
        return queryResult()
    }
  })
}

describe('InstanceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Deployment actions belong with deployment status, while the footer remains the access status area.
  describe('Deployment status action placement', () => {
    it('should render the deploy action in the deployment status group when no environment is deployed', () => {
      // Arrange
      mockCardQueries()

      // Act
      render(<InstanceCard app={appInstance()} />)

      // Assert
      const deploymentStatus = screen.getByRole('group', { name: 'deployments.card.tooltip.deploymentStatus' })
      const accessStatus = screen.getByRole('group', { name: 'deployments.overview.accessStatus' })

      expect(within(deploymentStatus).getByRole('button', { name: 'deployments.card.menu.deploy' })).toBeInTheDocument()
      expect(within(accessStatus).queryByRole('button', { name: 'deployments.card.menu.deploy' })).not.toBeInTheDocument()
      expect(within(accessStatus).getByRole('link', { name: 'deployments.card.access.webApp' })).toBeInTheDocument()
    })
  })
})
