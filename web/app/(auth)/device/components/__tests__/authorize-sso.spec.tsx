import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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

vi.mock('@/service/device-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/device-flow')>()),
  fetchApprovalContext: () => mockFetchApprovalContext(),
  approveExternal: (...args: unknown[]) => mockApproveExternal(...args),
}))

describe('AuthorizeSSO', () => {
  beforeEach(() => {
    mockFetchApprovalContext.mockReset().mockResolvedValue(mockCtx)
    mockApproveExternal.mockReset().mockResolvedValue(undefined)
  })

  it('authorizes the displayed SSO identity using its server-provided context and user code', async () => {
    const user = userEvent.setup()
    const onApproved = vi.fn()
    render(<AuthorizeSSO onApproved={onApproved} onError={vi.fn()} />)
    await screen.findByRole('button', { name: /deviceFlow.authorize.approve/i })
    await user.click(screen.getByRole('button', { name: /deviceFlow.authorize.approve/i }))
    expect(screen.getByText('gareth@company.com')).toBeInTheDocument()
    expect(screen.getByText('Okta (okta.company.com)')).toBeInTheDocument()
    await waitFor(() => expect(onApproved).toHaveBeenCalledOnce())
    expect(mockApproveExternal).toHaveBeenCalledWith(mockCtx, mockCtx.user_code)
  })

  it('shows loadErr fallback when fetchApprovalContext rejects', async () => {
    mockFetchApprovalContext.mockRejectedValue(new Error('network'))
    render(<AuthorizeSSO onApproved={vi.fn()} onError={vi.fn()} />)
    await screen.findByText('deviceFlow.authorize.sessionInvalidTitle')
  })

  it('reports approval failure without advancing the authorization flow', async () => {
    const user = userEvent.setup()
    const onApproved = vi.fn()
    mockApproveExternal.mockRejectedValue(new Error('unexpected'))
    const onError = vi.fn()
    render(<AuthorizeSSO onApproved={onApproved} onError={onError} />)
    await screen.findByRole('button', { name: /deviceFlow.authorize.approve/i })
    await user.click(screen.getByRole('button', { name: /deviceFlow.authorize.approve/i }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('deviceFlow.approveError.default'))
    expect(onApproved).not.toHaveBeenCalled()
  })
})
