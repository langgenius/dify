import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AuthorizeSSO from '../authorize-sso'

const mockCtx = {
  subject_email: 'gareth@company.com',
  subject_issuer: 'Okta (okta.company.com)',
  user_code: 'ABCD-3456',
  csrf_token: 'tok',
  expires_at: '2099-01-01T00:00:00Z',
}

const mockFetchApprovalContext = vi.fn().mockResolvedValue(mockCtx)
const mockApproveExternal = vi.fn().mockResolvedValue(undefined)

vi.mock('@/service/device-flow', () => ({
  fetchApprovalContext: () => mockFetchApprovalContext(),
  approveExternal: (...args: unknown[]) => mockApproveExternal(...args),
  DeviceFlowError: class extends Error {
    code: string
    status: number
    constructor(code: string, status = 400) {
      super(code)
      this.code = code
      this.status = status
    }
  },
}))

describe('AuthorizeSSO', () => {
  it('renders subject_email and issuer after context loads', async () => {
    render(<AuthorizeSSO onApproved={vi.fn()} onError={vi.fn()} />)
    await screen.findByText('gareth@company.com')
    expect(screen.getByText('Okta (okta.company.com)')).toBeInTheDocument()
  })

  it('renders single Authorize button with no Cancel', async () => {
    render(<AuthorizeSSO onApproved={vi.fn()} onError={vi.fn()} />)
    await screen.findByRole('button', { name: /Authorize/i })
    expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument()
  })

  it('calls approveExternal on Authorize click then calls onApproved', async () => {
    const onApproved = vi.fn()
    render(<AuthorizeSSO onApproved={onApproved} onError={vi.fn()} />)
    await screen.findByRole('button', { name: /Authorize/i })
    await userEvent.click(screen.getByRole('button', { name: /Authorize/i }))
    await waitFor(() => expect(onApproved).toHaveBeenCalled())
  })
})
