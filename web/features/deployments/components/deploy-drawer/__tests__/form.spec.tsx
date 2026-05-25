import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import type { ComponentProps } from 'react'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RUNTIME_INSTANCE_STATUS_READY,
  RUNTIME_INSTANCE_STATUS_UNDEPLOYED,
} from '../../../runtime-status'
import { DeployForm } from '../form'

type QueryOptions = {
  queryKey?: string[]
}

type QueryResult = {
  data?: unknown
  isLoading: boolean
  isFetching?: boolean
  isError: boolean
}

const mocks = vi.hoisted(() => ({
  deployMutate: vi.fn(),
  useQuery: vi.fn<(options: QueryOptions) => QueryResult>(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    isPending: false,
    mutate: mocks.deployMutate,
  }),
  useQuery: (options: QueryOptions) => mocks.useQuery(options),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      deploymentService: {
        deploy: {
          mutationOptions: () => ({ mutationKey: ['deploy'] }),
        },
        listEnvironmentDeployments: {
          queryOptions: () => ({ queryKey: ['runtime-instances'] }),
        },
      },
      releaseService: {
        listReleaseCredentialCandidates: {
          queryOptions: () => ({ queryKey: ['credential-options'] }),
        },
        listReleases: {
          queryOptions: () => ({ queryKey: ['release-history'] }),
        },
      },
    },
  },
}))

function release(overrides: Partial<Release> = {}): Release {
  return {
    id: 'release-1',
    name: 'R-001',
    gateCommitId: 'abcdef123456',
    ...overrides,
  }
}

function runtimeRow(overrides: Partial<EnvironmentDeployment> = {}): EnvironmentDeployment {
  return {
    environment: {
      id: 'env-prod',
      name: 'Production',
    },
    status: RUNTIME_INSTANCE_STATUS_READY,
    currentRelease: { id: 'release-1', name: 'R-001' },
    currentDeployment: { id: 'deployment-1' },
    ...overrides,
  }
}

function mockDeployFormQueries(rows: EnvironmentDeployment[]) {
  mocks.useQuery.mockImplementation((options: QueryOptions) => {
    switch (options.queryKey?.[0]) {
      case 'runtime-instances':
        return {
          data: { data: rows },
          isLoading: false,
          isError: false,
        }
      case 'release-history':
        return {
          data: { data: [release()] },
          isLoading: false,
          isError: false,
        }
      case 'credential-options':
        return {
          data: { slots: [] },
          isLoading: false,
          isFetching: false,
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
}

function renderDeployForm(props: ComponentProps<typeof DeployForm>) {
  return render(
    <Dialog open>
      <DialogContent>
        <DeployForm {...props} />
      </DialogContent>
    </Dialog>,
  )
}

describe('DeployForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // New environment deployment should only show environments that do not already have an instance.
  describe('Target environment options', () => {
    it('should default to an undeployed environment when deploying to a new environment', () => {
      // Arrange
      mockDeployFormQueries([
        runtimeRow(),
        runtimeRow({
          environment: { id: 'env-staging', name: 'Staging' },
          status: RUNTIME_INSTANCE_STATUS_UNDEPLOYED,
          currentRelease: undefined,
          currentDeployment: undefined,
        }),
      ])

      // Act
      renderDeployForm({ appInstanceId: 'instance-1' })

      // Assert
      expect(screen.getByText('Staging · deployments.mode.shared · K8S')).toBeInTheDocument()
      expect(screen.queryByText('Production · deployments.mode.shared · K8S')).not.toBeInTheDocument()
    })

    it('should show an empty target message when every environment already has an instance', () => {
      // Arrange
      mockDeployFormQueries([runtimeRow()])

      // Act
      renderDeployForm({ appInstanceId: 'instance-1' })

      // Assert
      expect(screen.getByText('deployments.deployDrawer.noNewEnvironmentAvailable')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'deployments.deployDrawer.deploy' })).toBeDisabled()
    })

    it('should keep the locked deployed environment for existing instance actions', () => {
      // Arrange
      mockDeployFormQueries([runtimeRow()])

      // Act
      renderDeployForm({ appInstanceId: 'instance-1', lockedEnvId: 'env-prod' })

      // Assert
      expect(screen.getByText('Production')).toBeInTheDocument()
      expect(screen.queryByText('deployments.deployDrawer.noNewEnvironmentAvailable')).not.toBeInTheDocument()
    })
  })
})
