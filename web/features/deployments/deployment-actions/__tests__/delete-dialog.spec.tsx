import type { DeploymentActionAppInstance } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScopeProvider } from 'jotai-scope'
import { DeleteDeploymentDialog } from '../delete-dialog'
import {
  deleteDeploymentDialogOpenAtom,
  deploymentActionAppInstanceAtom,
} from '../state'

const deleteMutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}))

const useMutationMock = vi.hoisted(() =>
  vi.fn(() => ({
    isPending: deleteMutationMock.isPending,
    mutate: deleteMutationMock.mutate,
  })),
)

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
}))

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMock,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appInstanceService: {
        deleteAppInstance: {
          mutationOptions: () => ({ mutationKey: ['deleteAppInstance'] }),
        },
      },
    },
  },
}))

function createAppInstance(overrides: Partial<DeploymentActionAppInstance> = {}): DeploymentActionAppInstance {
  return {
    id: 'app-instance-1',
    displayName: 'Deployment 1',
    description: 'Initial description',
    ...overrides,
  }
}

function renderDialog({
  appInstance = createAppInstance(),
  open = true,
}: {
  appInstance?: DeploymentActionAppInstance
  open?: boolean
} = {}) {
  render(
    <ScopeProvider
      atoms={[
        [deploymentActionAppInstanceAtom, appInstance],
        [deleteDeploymentDialogOpenAtom, open],
      ]}
      name="DeleteDeploymentDialogTest"
    >
      <DeleteDeploymentDialog />
    </ScopeProvider>,
  )
}

describe('DeleteDeploymentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteMutationMock.isPending = false
  })

  describe('Delete action', () => {
    it('should not mount the delete mutation before the dialog is opened', () => {
      renderDialog({ open: false })

      expect(useMutationMock).not.toHaveBeenCalled()
    })

    it('should delete the deployment through the component mutation', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByRole('button', { name: 'deployments.settings.delete' }))

      expect(deleteMutationMock.mutate).toHaveBeenCalledWith({
        params: {
          appInstanceId: 'app-instance-1',
        },
      }, expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
        onSettled: expect.any(Function),
      }))
    })
  })
})
