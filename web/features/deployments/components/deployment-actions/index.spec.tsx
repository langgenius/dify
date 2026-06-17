import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeploymentActionsMenu } from './index'

vi.mock('@langgenius/dify-ui/dropdown-menu', () => import('@/__mocks__/base-ui-dropdown-menu'))

vi.mock('./edit-dialog', () => ({
  EditDeploymentDialog: () => null,
}))

vi.mock('./delete-dialog', () => ({
  DeleteDeploymentDialog: () => null,
}))

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
})
