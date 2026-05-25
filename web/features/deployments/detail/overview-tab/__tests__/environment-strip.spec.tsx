import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RUNTIME_INSTANCE_STATUS_READY } from '../../../runtime-status'
import { EnvironmentStrip } from '../environment-strip'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
  }),
}))

const releaseRows = [
  { id: 'release-1', name: 'Release 1' },
] satisfies Release[]

function runtimeRow(index: number, name: string): EnvironmentDeployment {
  return {
    environment: { id: `env-${index}`, name },
    status: RUNTIME_INSTANCE_STATUS_READY,
    currentRelease: releaseRows[0],
    currentDeployment: { id: `deployment-${index}` },
  }
}

describe('EnvironmentStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The overview should stay compact and defer the full runtime list to the instances tab.
  describe('Runtime instance preview', () => {
    it('should render at most three runtime instances', () => {
      // Arrange
      const rows = [
        runtimeRow(1, 'Production'),
        runtimeRow(2, 'Staging'),
        runtimeRow(3, 'QA'),
        runtimeRow(4, 'UAT'),
      ]

      // Act
      render(
        <EnvironmentStrip
          appInstanceId="instance-1"
          rows={rows}
          releaseRows={releaseRows}
          isLoading={false}
          isError={false}
        />,
      )

      // Assert
      expect(screen.getByRole('heading', { name: 'deployments.overview.strip.title' })).toBeInTheDocument()
      expect(screen.getByText('Production')).toBeInTheDocument()
      expect(screen.getByText('Staging')).toBeInTheDocument()
      expect(screen.getByText('QA')).toBeInTheDocument()
      expect(screen.queryByText('UAT')).not.toBeInTheDocument()
    })
  })
})
