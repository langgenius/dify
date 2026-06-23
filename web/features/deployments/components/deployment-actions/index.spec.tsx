import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeploymentActionsMenu } from './index'

vi.mock('@langgenius/dify-ui/dropdown-menu', () => import('@/__mocks__/base-ui-dropdown-menu'))

vi.mock('./edit-dialog', async () => {
  const { useAtomValue } = await import('jotai')
  const { editDeploymentDialogOpenAtom } = await import('./state')

  return {
    EditDeploymentDialog: () => {
      const open = useAtomValue(editDeploymentDialogOpenAtom)

      return <div data-testid="edit-dialog" data-open={String(open)} />
    },
  }
})

vi.mock('./delete-dialog', async () => {
  const { useAtomValue } = await import('jotai')
  const { deleteDeploymentDialogOpenAtom } = await import('./state')

  return {
    DeleteDeploymentDialog: () => {
      const open = useAtomValue(deleteDeploymentDialogOpenAtom)

      return <div data-testid="delete-dialog" data-open={String(open)} />
    },
  }
})

describe('DeploymentActionsMenu', () => {
  it('keeps the trigger wrapper visible while the menu is open', () => {
    const { container } = render(
      <DeploymentActionsMenu
        appInstanceId="app-instance-1"
        placement="bottom-end"
        className="pointer-events-none opacity-0"
      />,
    )

    const wrapper = container.querySelector('[role="presentation"]') as HTMLElement
    expect(wrapper).toHaveClass('pointer-events-none', 'opacity-0')

    fireEvent.click(screen.getByTestId('dropdown-menu-trigger'))

    expect(screen.getByText('deployments.card.menu.editInfo')).toBeInTheDocument()
    expect(wrapper).toHaveClass('pointer-events-auto', 'opacity-100')
    expect(wrapper).not.toHaveClass('pointer-events-none', 'opacity-0')
  })

  it('keeps edit and delete dialog open state independent', () => {
    render(
      <DeploymentActionsMenu
        appInstanceId="app-instance-1"
        placement="bottom-end"
      />,
    )

    fireEvent.click(screen.getByTestId('dropdown-menu-trigger'))
    fireEvent.click(screen.getByText('deployments.card.menu.editInfo'))
    expect(screen.getByTestId('edit-dialog')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('delete-dialog')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByTestId('dropdown-menu-trigger'))
    fireEvent.click(screen.getByText('deployments.card.menu.delete'))
    expect(screen.getByTestId('edit-dialog')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('delete-dialog')).toHaveAttribute('data-open', 'true')
  })

  it('resets dialog state when the menu app instance changes', () => {
    const { rerender } = render(
      <DeploymentActionsMenu
        appInstanceId="app-instance-1"
        placement="bottom-end"
      />,
    )

    fireEvent.click(screen.getByTestId('dropdown-menu-trigger'))
    fireEvent.click(screen.getByText('deployments.card.menu.editInfo'))
    expect(screen.getByTestId('edit-dialog')).toHaveAttribute('data-open', 'true')

    rerender(
      <DeploymentActionsMenu
        appInstanceId="app-instance-2"
        placement="bottom-end"
      />,
    )
    expect(screen.getByTestId('edit-dialog')).toHaveAttribute('data-open', 'false')

    rerender(
      <DeploymentActionsMenu
        appInstanceId="app-instance-1"
        placement="bottom-end"
      />,
    )
    expect(screen.getByTestId('edit-dialog')).toHaveAttribute('data-open', 'false')
  })
})
