import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuthorizeSSO from '../authorize-sso'

const mockCtx = {
  subject_email: 'gareth@company.com',
  subject_issuer: 'Okta (okta.company.com)',
  user_code: 'ABCD-3456',
  csrf_token: 'tok',
  expires_at: '2099-01-01T00:00:00Z',
}

const mockFetchApprovalContext = vi.fn()
const mockApproveExternal = vi.fn()

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
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchApprovalContext.mockResolvedValue(mockCtx)
    mockApproveExternal.mockResolvedValue(undefined)
  })

  it('renders subject_email and issuer after context loads', async () => {
    render(<AuthorizeSSO onApproved={vi.fn()} onError={vi.fn()} />)
    await screen.findByText('gareth@company.com')
    expect(screen.getByText('Okta (okta.company.com)')).toBeInTheDocument()
  })

  it('renders single Authorize button with no Cancel', async () => {
    render(<AuthorizeSSO onApproved={vi.fn()} onError={vi.fn()} />)
    await screen.findByRole('button', { name: /deviceFlow.authorize.approve/i })
    expect(
      screen.queryByRole('button', { name: /common.operation.cancel/i }),
    ).not.toBeInTheDocument()
  })

  it('calls approveExternal with ctx and user_code on Authorize click', async () => {
    render(<AuthorizeSSO onApproved={vi.fn()} onError={vi.fn()} />)
    await screen.findByRole('button', { name: /deviceFlow.authorize.approve/i })
    await userEvent.click(screen.getByRole('button', { name: /deviceFlow.authorize.approve/i }))
    await waitFor(() =>
      expect(mockApproveExternal).toHaveBeenCalledWith(mockCtx, mockCtx.user_code),
    )
  })

  it('calls onApproved after successful approve', async () => {
    const onApproved = vi.fn()
    render(<AuthorizeSSO onApproved={onApproved} onError={vi.fn()} />)
    await screen.findByRole('button', { name: /deviceFlow.authorize.approve/i })
    await userEvent.click(screen.getByRole('button', { name: /deviceFlow.authorize.approve/i }))
    await waitFor(() => expect(onApproved).toHaveBeenCalled())
  })

  it('shows loadErr fallback when fetchApprovalContext rejects', async () => {
    mockFetchApprovalContext.mockRejectedValue(new Error('network'))
    render(<AuthorizeSSO onApproved={vi.fn()} onError={vi.fn()} />)
    await screen.findByText('deviceFlow.authorize.sessionInvalidTitle')
  })

  it('calls onError when approveExternal throws', async () => {
    mockApproveExternal.mockRejectedValue(new Error('unexpected'))
    const onError = vi.fn()
    render(<AuthorizeSSO onApproved={vi.fn()} onError={onError} />)
    await screen.findByRole('button', { name: /deviceFlow.authorize.approve/i })
    await userEvent.click(screen.getByRole('button', { name: /deviceFlow.authorize.approve/i }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(String)))
  })
})
