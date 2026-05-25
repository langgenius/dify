import type { EnvironmentDeployment } from '@dify/contracts/enterprise/types.gen'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RUNTIME_INSTANCE_STATUS_DEPLOYING,
  RUNTIME_INSTANCE_STATUS_FAILED,
  RUNTIME_INSTANCE_STATUS_READY,
  RUNTIME_INSTANCE_STATUS_UNDEPLOYED,
} from '../../runtime-status'
import { DeployTab } from '../deploy-tab'

type QueryOptions = {
  queryKey?: string[]
}

type QueryResult = {
  data?: { data?: EnvironmentDeployment[] }
  isLoading: boolean
  isError: boolean
}

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn<(options: QueryOptions) => QueryResult>(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useQuery: (options: QueryOptions) => mocks.useQuery(options),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      deploymentService: {
        listEnvironmentDeployments: {
          queryOptions: () => ({ queryKey: ['runtime-instances'] }),
        },
        undeploy: {
          mutationOptions: () => ({ mutationKey: ['undeploy'] }),
        },
      },
    },
  },
}))

function runtimeRow(overrides: Partial<EnvironmentDeployment> = {}): EnvironmentDeployment {
  return {
    environment: { id: 'env-1', name: 'Production' },
    status: RUNTIME_INSTANCE_STATUS_READY,
    currentRelease: { id: 'release-1', name: 'R-001' },
    currentDeployment: { id: 'deployment-1' },
    ...overrides,
  }
}

function mockRuntimeRows(rows: EnvironmentDeployment[]) {
  mocks.useQuery.mockReturnValue({
    data: { data: rows },
    isLoading: false,
    isError: false,
  })
}

describe('DeployTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The instances page should focus on environments that already have a runtime instance.
  describe('Runtime instance list', () => {
    it('should hide environments without an instance from the list', () => {
      // Arrange
      mockRuntimeRows([
        runtimeRow(),
        runtimeRow({
          environment: { id: 'env-empty', name: 'Empty environment' },
          status: RUNTIME_INSTANCE_STATUS_UNDEPLOYED,
          currentRelease: undefined,
          currentDeployment: undefined,
        }),
        runtimeRow({
          environment: { id: 'env-deploying', name: 'Staging' },
          status: RUNTIME_INSTANCE_STATUS_DEPLOYING,
          desiredRelease: { id: 'release-2', name: 'R-002' },
          currentRelease: undefined,
        }),
        runtimeRow({
          environment: { id: 'env-failed', name: 'QA' },
          status: RUNTIME_INSTANCE_STATUS_FAILED,
          currentRelease: undefined,
        }),
      ])

      // Act
      render(<DeployTab appInstanceId="instance-1" />)

      // Assert
      expect(screen.getAllByText('Production').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Staging').length).toBeGreaterThan(0)
      expect(screen.getAllByText('QA').length).toBeGreaterThan(0)
      expect(screen.queryByText('Empty environment')).not.toBeInTheDocument()
    })

    it('should show the empty state when every environment is undeployed', () => {
      // Arrange
      mockRuntimeRows([
        runtimeRow({
          environment: { id: 'env-empty', name: 'Empty environment' },
          status: RUNTIME_INSTANCE_STATUS_UNDEPLOYED,
          currentRelease: undefined,
          currentDeployment: undefined,
        }),
      ])

      // Act
      render(<DeployTab appInstanceId="instance-1" />)

      // Assert
      expect(screen.getByText('deployments.deployTab.empty')).toBeInTheDocument()
      expect(screen.queryByText('Empty environment')).not.toBeInTheDocument()
    })
  })
})
