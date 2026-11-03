import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Recipient as RecipientItem } from '../../../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EmailInput from '../email-input'

const createMember = (overrides: Partial<AccountWithRoleResponse>): AccountWithRoleResponse => ({
  id: 'member-1',
  email: 'member-1@example.com',
  name: 'Member One',
  avatar: 'avatar-data',
  avatar_url: 'avatar.png',
  status: 'active',
  role: 'normal',
  roles: [],
  created_at: 1767225600,
  last_active_at: 1767312000,
  last_login_at: 1767398400,
  ...overrides,
})

const members: AccountWithRoleResponse[] = [
  createMember({}),
  createMember({
    id: 'member-2',
    email: 'member-2@example.com',
    name: 'Member Two',
  }),
]

describe('human-input/delivery-method/recipient/email-input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selects an unselected member from the real suggestions', async () => {
    const user = userEvent.setup()
    const handleSelect = vi.fn()
    const handleDelete = vi.fn()
    render(
      <EmailInput
        email="owner@example.com"
        value={[{ type: 'member', user_id: 'member-1' } as RecipientItem]}
        list={members}
        onDelete={handleDelete}
        onSelect={handleSelect}
        onAdd={vi.fn()}
      />,
    )

    expect(screen.getByText('member-1@example.com')).toBeInTheDocument()

    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', '')

    await user.click(input)
    expect(input).toHaveAttribute(
      'placeholder',
      'workflowHumanInput.nodes.humanInput.deliveryMethod.emailConfigure.memberSelector.placeholder',
    )

    await user.type(input, 'member')
    expect(screen.getByRole('button', { name: /Member One/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Member Two/ }))

    expect(handleSelect).toHaveBeenCalledWith('member-2')
  })

  it('should add external emails, select existing members, and ignore invalid or duplicate values', () => {
    const handleSelect = vi.fn()
    const handleAdd = vi.fn()

    render(
      <EmailInput
        email="owner@example.com"
        value={[{ type: 'external', email: 'existing@example.com' } as RecipientItem]}
        list={members}
        onDelete={vi.fn()}
        onSelect={handleSelect}
        onAdd={handleAdd}
      />,
    )

    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: 'member-2@example.com' } })
    fireEvent.keyDown(input, { key: ',', code: 'Comma' })
    expect(handleSelect).toHaveBeenCalledWith('member-2')

    fireEvent.change(input, { target: { value: 'new@example.com' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    expect(handleAdd).toHaveBeenCalledWith('new@example.com')

    fireEvent.change(input, { target: { value: 'existing@example.com' } })
    fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' })

    fireEvent.change(input, { target: { value: 'bad-email' } })
    fireEvent.blur(input)

    expect(handleAdd).toHaveBeenCalledTimes(1)
    expect(handleSelect).toHaveBeenCalledTimes(1)
  })

  it.each([
    { value: '', expectedAdds: 0 },
    { value: 'bad-email', expectedAdds: 0 },
    { value: 'existing@example.com', expectedAdds: 0 },
    { value: 'new@example.com', expectedAdds: 1 },
  ])(
    'should allow Tab to leave "$value" and add a valid email only once',
    async ({ value, expectedAdds }) => {
      const user = userEvent.setup()
      const handleAdd = vi.fn()
      render(
        <>
          <EmailInput
            email="owner@example.com"
            value={[{ type: 'external', email: 'existing@example.com' }]}
            list={members}
            onDelete={vi.fn()}
            onSelect={vi.fn()}
            onAdd={handleAdd}
          />
          <button type="button">Save</button>
        </>,
      )
      const input = screen.getByRole('textbox')
      await user.click(input)
      if (value) await user.type(input, value)
      await user.tab()
      expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
      expect(handleAdd).toHaveBeenCalledTimes(expectedAdds)
      if (expectedAdds) expect(handleAdd).toHaveBeenCalledWith(value)
    },
  )

  it('should allow Shift+Tab to return to the previous control', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Previous</button>
        <EmailInput
          email="owner@example.com"
          value={[]}
          list={members}
          onDelete={vi.fn()}
          onSelect={vi.fn()}
          onAdd={vi.fn()}
        />
      </>,
    )
    await user.click(screen.getByRole('textbox'))
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveFocus()
  })

  it('should keep typing focused and stop keyboard events from reaching workflow listeners', () => {
    const handleParentKeyDown = vi.fn()
    const handleWindowKeyDown = vi.fn()
    window.addEventListener('keydown', handleWindowKeyDown)

    try {
      render(
        <div onKeyDown={handleParentKeyDown}>
          <EmailInput
            email="owner@example.com"
            value={[]}
            list={members}
            onDelete={vi.fn()}
            onSelect={vi.fn()}
            onAdd={vi.fn()}
          />
        </div>,
      )

      const input = screen.getByRole('textbox')
      input.focus()

      fireEvent.change(input, { target: { value: 'a' } })
      fireEvent.keyDown(input, { key: 'a', code: 'KeyA' })

      expect(document.activeElement).toBe(input)
      expect(handleParentKeyDown).not.toHaveBeenCalled()
      expect(handleWindowKeyDown).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', handleWindowKeyDown)
    }
  })

  it('removes an unavailable member with Backspace and hides input when disabled', () => {
    const handleDelete = vi.fn()
    const { rerender } = render(
      <EmailInput
        email="owner@example.com"
        value={[{ type: 'member', user_id: 'missing-member' } as RecipientItem]}
        list={members}
        onDelete={handleDelete}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Backspace', code: 'Backspace' })
    expect(handleDelete).toHaveBeenCalledWith({ type: 'member', user_id: 'missing-member' })

    rerender(
      <EmailInput
        email="owner@example.com"
        value={[]}
        list={members}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        disabled
      />,
    )

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
