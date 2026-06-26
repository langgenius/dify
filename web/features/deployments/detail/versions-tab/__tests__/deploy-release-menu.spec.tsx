import type { Release } from '@dify/contracts/enterprise/types.gen'
import { ReleaseSource } from '@dify/contracts/enterprise/types.gen'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeployReleaseMenu } from '../deploy-release-menu'

const mockDeleteRelease = vi.hoisted(() => vi.fn())
const mockExportReleaseDsl = vi.hoisted(() => vi.fn())

vi.mock('@langgenius/dify-ui/dropdown-menu', () => import('@/__mocks__/base-ui-dropdown-menu'))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useMutation: (options: { mutationKey?: readonly unknown[] }) => {
      if (options.mutationKey?.[0] === 'deployments')
        return { isPending: false, mutate: mockExportReleaseDsl }

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
  const { atom } = await import('jotai')

  return {
    ...actual,
    deployReleaseMenuEnvironmentDeploymentsQueryAtom: atom(environmentDeploymentsErrorResult()),
    deployReleaseMenuAppInstanceQueryAtom: atom(appInstanceResult()),
  }
})

vi.mock('../edit-release-dialog', () => ({
  EditReleaseDialog: () => null,
}))

vi.mock('../delete-release-dialog', () => ({
  DeleteReleaseDialog: ({ open }: { open: boolean }) => open ? <div role="dialog">delete confirm</div> : null,
}))

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

function environmentDeploymentsErrorResult() {
  return {
    isError: true,
    isLoading: false,
    data: undefined,
  }
}

function appInstanceResult() {
  return {
    data: {
      appInstance: {
        displayName: 'Deployment 1',
      },
    },
  }
}

describe('DeployReleaseMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should disable release deletion when deployment usage cannot be checked', () => {
    const release = createRelease()

    render(
      <DeployReleaseMenu
        releaseId={release.id}
        releaseRows={[release]}
      />,
    )

    fireEvent.click(screen.getByTestId('dropdown-menu-trigger'))
    const deleteItem = screen.getByRole('menuitem', { name: 'deployments.versions.deleteRelease' })

    expect(deleteItem).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(deleteItem)

    expect(screen.queryByText('delete confirm')).not.toBeInTheDocument()
    expect(mockDeleteRelease).not.toHaveBeenCalled()
  })
})
