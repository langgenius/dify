import type { ApproverConfig, Recipient } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import Approvers from '../approvers'

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({ data: { accounts: [] } }),
}))

vi.mock('../delivery-method/recipient/email-input', () => ({
  default: ({
    onAdd,
    onSelect,
    onDelete,
    value,
  }: {
    onAdd: (email: string) => void
    onSelect: (id: string) => void
    onDelete: (recipient: Recipient) => void
    value: Recipient[]
  }) => (
    <div>
      <button type="button" onClick={() => onAdd('reviewer@example.com')}>
        add-email
      </button>
      <button type="button" onClick={() => onSelect('member-1')}>
        add-member
      </button>
      <button
        type="button"
        onClick={() => onDelete({ type: 'external', email: 'reviewer@example.com' })}
      >
        remove-email
      </button>
      <output data-testid="recipients">{JSON.stringify(value)}</output>
    </div>
  ),
}))

const Harness = () => {
  const [value, setValue] = useState<ApproverConfig | null>(null)

  return (
    <>
      <Approvers value={value} onChange={setValue} readOnly={false} />
      <output data-testid="policy">{JSON.stringify(value)}</output>
    </>
  )
}

describe('human-input/approvers', () => {
  it('updates members, external email addresses, and roles', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('switch'))
    await user.click(screen.getByRole('button', { name: 'add-member' }))
    await user.click(screen.getByRole('button', { name: 'add-email' }))
    await user.click(
      screen.getByRole('checkbox', {
        name: 'workflowHumanInput.nodes.humanInput.approvers.role.admin',
      }),
    )

    expect(JSON.parse(screen.getByTestId('policy').textContent || '')).toEqual({
      member_ids: ['member-1'],
      emails: ['reviewer@example.com'],
      roles: ['admin'],
    })

    await user.click(screen.getByRole('button', { name: 'remove-email' }))
    expect(JSON.parse(screen.getByTestId('policy').textContent || '').emails).toEqual([])
  })
})
