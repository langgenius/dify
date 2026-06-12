import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RoleTag from '../role-tag'

describe('RoleTag', () => {
  it('should show remove when locked binding can change lock status', async () => {
    render(
      <RoleTag
        id="role-1"
        bindingId="binding-1"
        label="Admin"
        type="role"
        isLocked
        canChangeLockStatus
        showRemove
        onRemove={vi.fn()}
        onToggleLockStatus={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /permission\.accessRule\.bindingActionsAria.*Admin/ }))

    expect(screen.getByRole('menuitem', { name: /common\.operation\.remove/ })).toBeInTheDocument()
  })

  it('should hide remove when locked binding cannot change lock status', () => {
    render(
      <RoleTag
        id="role-1"
        bindingId="binding-1"
        label="Admin"
        type="role"
        isLocked
        showRemove
        onRemove={vi.fn()}
      />,
    )

    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /permission\.accessRule\.bindingActionsAria.*Admin/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /common\.operation\.remove/ })).not.toBeInTheDocument()
  })

  it('should show remove when unlocked binding cannot change lock status', async () => {
    render(
      <RoleTag
        id="role-1"
        bindingId="binding-1"
        label="Admin"
        type="role"
        showRemove
        onRemove={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /permission\.accessRule\.bindingActionsAria.*Admin/ }))

    expect(screen.getByRole('menuitem', { name: /common\.operation\.remove/ })).toBeInTheDocument()
  })
})
