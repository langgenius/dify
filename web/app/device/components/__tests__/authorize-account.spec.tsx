import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuthorizeAccount from '../authorize-account'

const mockApproveAccount = vi.fn()
const mockDenyAccount = vi.fn()

vi.mock('@/service/device-flow', () => ({
  deviceApproveAccount: (...args: unknown[]) => mockApproveAccount(...args),
  deviceDenyAccount: (...args: unknown[]) => mockDenyAccount(...args),
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

const makeProps = () => ({
  userCode: 'ABCD-3456',
  accountEmail: 'gareth@example.com',
  accountName: 'Gareth Chen',
  accountAvatarUrl: null,
  defaultWorkspace: 'Dify Enterprise',
  onApproved: vi.fn(),
  onDenied: vi.fn(),
  onError: vi.fn(),
})

describe('AuthorizeAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApproveAccount.mockResolvedValue(undefined)
    mockDenyAccount.mockResolvedValue(undefined)
  })

  it('renders accountName', () => {
    render(<AuthorizeAccount {...makeProps()} />)
    expect(screen.getByText('Gareth Chen')).toBeInTheDocument()
  })

  it('renders accountEmail', () => {
    render(<AuthorizeAccount {...makeProps()} />)
    expect(screen.getByText('gareth@example.com')).toBeInTheDocument()
  })

  it('renders defaultWorkspace', () => {
    render(<AuthorizeAccount {...makeProps()} />)
    expect(screen.getByText(/Dify Enterprise/)).toBeInTheDocument()
  })

  it('calls deviceApproveAccount with userCode on Authorize click', async () => {
    render(<AuthorizeAccount {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }))
    await waitFor(() => expect(mockApproveAccount).toHaveBeenCalledWith('ABCD-3456'))
  })

  it('calls onApproved after successful approve', async () => {
    const props = makeProps()
    render(<AuthorizeAccount {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }))
    await waitFor(() => expect(props.onApproved).toHaveBeenCalled())
  })

  it('calls deviceDenyAccount with userCode on Cancel click', async () => {
    render(<AuthorizeAccount {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    await waitFor(() => expect(mockDenyAccount).toHaveBeenCalledWith('ABCD-3456'))
  })

  it('calls onDenied after successful deny', async () => {
    const props = makeProps()
    render(<AuthorizeAccount {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    await waitFor(() => expect(props.onDenied).toHaveBeenCalled())
  })

  it('calls onError when approve throws', async () => {
    mockApproveAccount.mockRejectedValue(new Error('unexpected'))
    const props = makeProps()
    render(<AuthorizeAccount {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Authorize/i }))
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.any(String)))
  })
})
