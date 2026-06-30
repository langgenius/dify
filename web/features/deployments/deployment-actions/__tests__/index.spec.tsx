import type { DeploymentActionAppInstance } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeploymentActionsMenu } from '../index'

const editDialogMock = vi.hoisted(() => vi.fn())
const deleteDialogMock = vi.hoisted(() => vi.fn())

vi.mock('../edit-dialog', async () => {
  const { useAtomValue } = await import('jotai')
  const { deploymentActionAppInstanceAtom, editDeploymentDialogOpenAtom } = await import('../state')

  return {
    EditDeploymentDialog: () => {
      const open = useAtomValue(editDeploymentDialogOpenAtom)
      const appInstance = useAtomValue(deploymentActionAppInstanceAtom)
      editDialogMock({ appInstanceId: appInstance.id, open })

      return <div data-testid="edit-dialog" data-open={String(open)} />
    },
  }
})

vi.mock('../delete-dialog', async () => {
  const { useAtomValue } = await import('jotai')
  const { deleteDeploymentDialogOpenAtom, deploymentActionAppInstanceAtom } = await import('../state')

  return {
    DeleteDeploymentDialog: () => {
      const open = useAtomValue(deleteDeploymentDialogOpenAtom)
      const appInstance = useAtomValue(deploymentActionAppInstanceAtom)
      deleteDialogMock({ appInstanceId: appInstance.id, open })

      return <div data-testid="delete-dialog" data-open={String(open)} />
    },
  }
})

function createAppInstance(overrides: Partial<DeploymentActionAppInstance> = {}): DeploymentActionAppInstance {
  return {
    id: 'app-instance-1',
    displayName: 'Deployment 1',
    description: 'Initial description',
    ...overrides,
  }
}

describe('DeploymentActionsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the trigger wrapper visible through uncontrolled menu state', () => {
    const { container } = render(
      <DeploymentActionsMenu
        appInstance={createAppInstance()}
        placement="bottom-end"
        className="pointer-events-none opacity-0"
      />,
    )

    const wrapper = container.querySelector('[role="presentation"]') as HTMLElement
    expect(wrapper).toHaveClass(
      'pointer-events-none',
      'opacity-0',
      '[&:has([data-popup-open])]:pointer-events-auto',
      '[&:has([data-popup-open])]:opacity-100',
    )
  })

  it('opens edit and delete dialogs from menu items', async () => {
    const user = userEvent.setup()

    render(
      <DeploymentActionsMenu
        appInstance={createAppInstance()}
        placement="bottom-end"
      />,
    )

    expect(screen.getByTestId('edit-dialog')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('delete-dialog')).toHaveAttribute('data-open', 'false')

    await user.click(screen.getByRole('button', { name: 'deployments.card.moreActions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'deployments.card.menu.editInfo' }))

    expect(screen.getByTestId('edit-dialog')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('delete-dialog')).toHaveAttribute('data-open', 'false')

    await user.click(screen.getByRole('button', { name: 'deployments.card.moreActions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'deployments.card.menu.delete' }))

    expect(screen.getByTestId('edit-dialog')).toHaveAttribute('data-open', 'false')
    expect(screen.getByTestId('delete-dialog')).toHaveAttribute('data-open', 'true')
    expect(editDialogMock).toHaveBeenLastCalledWith({ appInstanceId: 'app-instance-1', open: false })
    expect(deleteDialogMock).toHaveBeenLastCalledWith({ appInstanceId: 'app-instance-1', open: true })
  })
})
