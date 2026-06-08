import type { Member } from '@/models/common'
import { fireEvent, render, screen } from '@testing-library/react'
import EmailItem from '../email-item'

describe('human-input/delivery-method/recipient/email-item', () => {
  it('should render the current user label and delete the recipient when enabled', () => {
    const handleDelete = vi.fn()
    const member: Member = {
      id: 'member-1',
      email: 'owner@example.com',
      name: 'Owner',
      avatar: 'avatar-data',
      avatar_url: 'avatar.png',
      status: 'active',
      role: 'normal',
      created_at: '2026-01-01T00:00:00Z',
      last_active_at: '2026-01-02T00:00:00Z',
      last_login_at: '2026-01-03T00:00:00Z',
    }
    const { container } = render(
      <EmailItem
        email="owner@example.com"
        data={member}
        onDelete={handleDelete}
        isError={false}
      />,
    )

    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('common.members.you')).toBeInTheDocument()

    fireEvent.click(container.querySelector('.cursor-pointer') as SVGElement)
    expect(handleDelete).toHaveBeenCalledWith(expect.objectContaining({
      id: 'member-1',
      email: 'owner@example.com',
    }))
  })

  it('should show an error style and hide delete when disabled', () => {
    const member: Member = {
      id: 'missing-member',
      email: 'missing@example.com',
      name: 'Missing',
      avatar: 'avatar-data',
      avatar_url: null,
      status: 'pending',
      role: 'normal',
      created_at: '2026-01-01T00:00:00Z',
      last_active_at: '2026-01-02T00:00:00Z',
      last_login_at: '2026-01-03T00:00:00Z',
    }
    const { container } = render(
      <EmailItem
        email="owner@example.com"
        data={member}
        onDelete={vi.fn()}
        disabled
        isError
      />,
    )

    expect(screen.getByTitle('missing@example.com')).toBeInTheDocument()
    expect(container.querySelector('.text-text-destructive')).toBeInTheDocument()
    expect(container.querySelector('.cursor-pointer')).not.toBeInTheDocument()
  })
})
