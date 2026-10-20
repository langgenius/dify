import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import InvitationLink from '../invitation-link'

vi.mock('copy-to-clipboard')

describe('InvitationLink', () => {
  const value = { email: 'test@example.com', status: 'success' as const, url: '/invite/123' }

  it('should copy relative url with origin', async () => {
    const user = userEvent.setup()
    render(<InvitationLink value={value} />)

    const copyBtn = screen.getByRole('button', { name: 'appApi.copy' })
    await user.click(copyBtn)

    expect(copy).toHaveBeenCalledWith(`${window.location.origin}/invite/123`)
  })

  it('should copy absolute url as is', async () => {
    const user = userEvent.setup()
    const absoluteValue = { ...value, url: 'https://dify.ai/invite/123' }

    render(<InvitationLink value={absoluteValue} />)

    await user.click(screen.getByRole('button', { name: 'https://dify.ai/invite/123' }))

    expect(copy).toHaveBeenCalledWith('https://dify.ai/invite/123')
  })
})
