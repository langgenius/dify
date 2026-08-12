import type { DeploymentActionAppInstance } from '../types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScopeProvider } from 'jotai-scope'
import { EditDeploymentDialog } from '../edit-dialog'
import { deploymentActionAppInstanceAtom, editDeploymentDialogOpenAtom } from '../state'

const updateMutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}))

const useMutationMock = vi.hoisted(() =>
  vi.fn(() => ({
    isPending: updateMutationMock.isPending,
    mutate: updateMutationMock.mutate,
  })),
)

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

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appInstanceService: {
        updateAppInstance: {
          mutationOptions: () => ({ mutationKey: ['updateAppInstance'] }),
        },
      },
    },
  },
}))

function createAppInstance(
  overrides: Partial<DeploymentActionAppInstance> = {},
): DeploymentActionAppInstance {
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
        [editDeploymentDialogOpenAtom, open],
      ]}
      name="EditDeploymentDialogTest"
    >
      <EditDeploymentDialog />
    </ScopeProvider>,
  )
}

describe('EditDeploymentDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateMutationMock.isPending = false
  })

  describe('Form submission', () => {
    it('should not mount the update mutation before the dialog is opened', () => {
      renderDialog({ open: false })

      expect(useMutationMock).not.toHaveBeenCalled()
    })

    it('should render form values from the passed app instance', () => {
      renderDialog()

      const dialog = screen.getByRole('dialog', { name: 'deployments.card.menu.editInfo' })
      expect(
        within(dialog).getByRole('textbox', { name: 'deployments.settings.name' }),
      ).toHaveValue('Deployment 1')
      expect(
        within(dialog).getByRole('textbox', { name: 'deployments.settings.description' }),
      ).toHaveValue('Initial description')
    })

    it('should submit trimmed deployment metadata through the component mutation', async () => {
      const user = userEvent.setup()
      renderDialog()

      const dialog = screen.getByRole('dialog', { name: 'deployments.card.menu.editInfo' })
      await user.clear(within(dialog).getByRole('textbox', { name: 'deployments.settings.name' }))
      await user.type(
        within(dialog).getByRole('textbox', { name: 'deployments.settings.name' }),
        ' Deployment 2 ',
      )
      await user.clear(
        within(dialog).getByRole('textbox', { name: 'deployments.settings.description' }),
      )
      await user.type(
        within(dialog).getByRole('textbox', { name: 'deployments.settings.description' }),
        ' Updated description ',
      )
      await user.click(within(dialog).getByRole('button', { name: 'deployments.settings.save' }))

      expect(updateMutationMock.mutate).toHaveBeenCalledWith(
        {
          params: {
            appInstanceId: 'app-instance-1',
          },
          body: {
            appInstanceId: 'app-instance-1',
            displayName: 'Deployment 2',
            description: 'Updated description',
          },
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      )
    })
  })
})
