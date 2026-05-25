import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RUNTIME_INSTANCE_STATUS_READY } from '../../../runtime-status'
import { DeployReleaseMenu } from '../deploy-release-menu'

const mockUseQuery = vi.fn()
const mockGet = vi.hoisted(() => vi.fn())
const mockDownloadBlob = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey?: string[] }) => mockUseQuery(options),
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
    },
  },
}))

vi.mock('@/service/base', () => ({
  get: (...args: unknown[]) => mockGet(...args),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}))

function release(overrides: Partial<Release> = {}): Release {
  return {
    id: 'release-1',
    name: 'R-001',
    createdAt: '2026-05-05T10:00:00Z',
    createdBy: { name: 'App-runner-demo' },
    ...overrides,
  }
}

function runtimeInstance(overrides: Partial<EnvironmentDeployment> = {}): EnvironmentDeployment {
  return {
    currentDeployment: { id: 'deployment-1' },
    environment: { id: 'env-1', name: 'test-1' },
    status: RUNTIME_INSTANCE_STATUS_READY,
    currentRelease: { id: 'release-1' },
    ...overrides,
  }
}

describe('DeployReleaseMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockImplementation((options: { queryKey?: string[] }) => {
      if (options.queryKey?.[0] === 'app-instance') {
        return {
          data: { appInstance: { id: 'instance-1', name: 'testchat' } },
          isLoading: false,
          isError: false,
        }
      }

      return {
        data: { data: [runtimeInstance()] },
        isLoading: false,
        isError: false,
      }
    })
    mockGet.mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['dsl'], { type: 'application/x-yaml' })),
    })
  })

  // The release action menu should expose the raw DSL export alongside deployment actions.
  describe('Export DSL', () => {
    it('should export the selected release DSL from the more actions menu', async () => {
      // Arrange
      const user = userEvent.setup()
      render(
        <DeployReleaseMenu
          appInstanceId="instance-1"
          releaseId="release-1"
          releaseRows={[release()]}
        />,
      )

      // Act
      await user.click(screen.getByRole('button', { name: 'deployments.versions.moreActions' }))
      await user.click(await screen.findByText('deployments.versions.exportDsl'))

      // Assert
      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith(
          'enterprise/app-deploy/releases/release-1/dsl',
          {},
          { needAllResponseContent: true, silent: true },
        )
      })
      expect(mockDownloadBlob).toHaveBeenCalledWith(expect.objectContaining({
        fileName: 'testchat-R-001.yaml',
      }))
    })
  })
})
