import type { EnvironmentDeployment, Release } from '@dify/contracts/enterprise/types.gen'
import { ReleaseSource } from '@dify/contracts/enterprise/types.gen'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeployReleaseMenu } from '../deploy-release-menu'

const mockDeleteRelease = vi.hoisted(() => vi.fn())
const mockExportReleaseDsl = vi.hoisted(() => vi.fn())
const mockMutationState = vi.hoisted(() => ({ exportPending: false }))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useMutation: (options: { mutationKey?: readonly unknown[] }) => {
      if (options.mutationKey?.[0] === 'deployments')
        return { isPending: mockMutationState.exportPending, mutate: mockExportReleaseDsl }

      return { isPending: false, mutate: mockDeleteRelease }
    },
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      releaseService: {
        deleteRelease: {
          mutationOptions: () => ({ mutationKey: ['deleteRelease'] }),
        },
      },
    },
  },
}))

vi.mock('../state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state')>()
  const { RuntimeInstanceStatus } = await import('@dify/contracts/enterprise/types.gen')
  const { atom } = await import('jotai')
  const currentRelease = {
    id: 'release-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as Release
  const previousRelease = {
    id: 'release-0',
    createdAt: '2025-12-01T00:00:00.000Z',
  } as Release
  const environmentDeployments = {
    environmentDeployments: [
      {
        environment: { id: 'env-current', displayName: 'Current' },
        status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
        currentRelease,
      },
      {
        environment: { id: 'env-available', displayName: 'Available' },
        status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
        currentRelease: previousRelease,
      },
    ] as EnvironmentDeployment[],
  }

  return {
    ...actual,
    deployReleaseMenuEnvironmentDeploymentsAtom: atom(environmentDeployments),
    deployReleaseMenuEnvironmentDeploymentsIsErrorAtom: atom(true),
    deployReleaseMenuEnvironmentDeploymentsIsLoadingAtom: atom(false),
    deployReleaseMenuAppInstanceNameAtom: atom('Deployment 1'),
  }
})

vi.mock('../edit-release-dialog', () => ({
  EditReleaseDialog: () => null,
}))

vi.mock('../delete-release-dialog', async () => {
  const { useAtomValue } = await import('jotai')
  const { deleteReleaseDialogOpenAtom } = await import('../state')

  return {
    DeleteReleaseDialog: () =>
      useAtomValue(deleteReleaseDialogOpenAtom) ? <div role="dialog">delete confirm</div> : null,
  }
})

vi.mock('../release-dsl-export', () => ({
  exportReleaseDsl: vi.fn(),
}))

function createRelease(): Release {
  return {
    id: 'release-1',
    appInstanceId: 'app-instance-1',
    displayName: 'Release 1',
    description: '',
    source: ReleaseSource.RELEASE_SOURCE_UPLOAD,
    gateCommitId: 'commit-1',
    requiredSlots: [],
    createdBy: {
      id: 'account-1',
      displayName: 'Dify Admin',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('DeployReleaseMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutationState.exportPending = false
  })

  it('should disable release deletion when deployment usage cannot be checked', () => {
    const release = createRelease()

    render(<DeployReleaseMenu releaseId={release.id} releaseRows={[release]} />)

    fireEvent.click(screen.getByLabelText('deployments.versions.moreActions'))
    const deleteItem = screen.getByRole('menuitem', { name: 'deployments.versions.deleteRelease' })

    expect(deleteItem).toHaveAttribute('aria-disabled', 'true')
    expect(deleteItem).toHaveAttribute('data-disabled')
    expect(deleteItem).toHaveClass('data-disabled:cursor-not-allowed', 'data-disabled:opacity-60')

    fireEvent.click(deleteItem)

    expect(screen.queryByText('delete confirm')).not.toBeInTheDocument()
    expect(mockDeleteRelease).not.toHaveBeenCalled()
  })

  it('should expose disabled state for exporting and unavailable environment actions', () => {
    mockMutationState.exportPending = true
    const release = createRelease()

    render(<DeployReleaseMenu releaseId={release.id} releaseRows={[release]} />)

    fireEvent.click(screen.getByLabelText('deployments.versions.moreActions'))

    const exportItem = screen.getByRole('menuitem', { name: 'deployments.versions.exportingDsl' })
    const currentEnvironmentItem = screen.getByRole('menuitem', {
      name: /deployments\.versions\.currentOn/,
    })
    const availableEnvironmentItem = screen.getByRole('menuitem', {
      name: /deployments\.versions\.(deployTo|rollbackTo)/,
    })
    expect(exportItem).toHaveAttribute('data-disabled')
    expect(currentEnvironmentItem).toHaveAttribute('data-disabled')
    expect(availableEnvironmentItem).not.toHaveAttribute('data-disabled')

    fireEvent.click(exportItem)
    expect(mockExportReleaseDsl).not.toHaveBeenCalled()
  })
})
