import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDeferred } from '@/test/deferred'
import AuthorizeAccount from '../authorize-account'

const { mockApproveAccount, mockDenyAccount } = vi.hoisted(() => ({
  mockApproveAccount: vi.fn(),
  mockDenyAccount: vi.fn(),
}))
vi.mock('@/service/device-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/device-flow')>()),
  deviceApproveAccount: mockApproveAccount,
  deviceDenyAccount: mockDenyAccount,
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

beforeEach(() => {
  mockApproveAccount.mockReset().mockResolvedValue(undefined)
  mockDenyAccount.mockReset().mockResolvedValue(undefined)
})

it.each(['approve', 'deny'] as const)(
  'submits %s once and reports completion only after the request succeeds',
  async (action) => {
    const user = userEvent.setup()
    const pending = createDeferred<void>()
    const request = action === 'approve' ? mockApproveAccount : mockDenyAccount
    request.mockReturnValueOnce(pending.promise)
    const props = makeProps()
    render(<AuthorizeAccount {...props} />)
    expect(screen.getByText('Gareth Chen')).toBeInTheDocument()
    expect(screen.getByText('gareth@example.com')).toBeInTheDocument()
    expect(screen.getByText('Dify Enterprise')).toBeInTheDocument()
    const approve = screen.getByRole('button', { name: 'deviceFlow.authorize.approve' })
    const deny = screen.getByRole('button', { name: 'common.operation.cancel' })
    await user.click(action === 'approve' ? approve : deny)
    expect(approve).toBeDisabled()
    expect(deny).toBeDisabled()
    await user.click(approve)
    await user.click(deny)
    expect(request).toHaveBeenCalledExactlyOnceWith('ABCD-3456')
    expect(props.onApproved).not.toHaveBeenCalled()
    expect(props.onDenied).not.toHaveBeenCalled()
    await act(async () => pending.resolve())
    await waitFor(() =>
      expect(action === 'approve' ? props.onApproved : props.onDenied).toHaveBeenCalledOnce(),
    )
    expect(action === 'approve' ? mockDenyAccount : mockApproveAccount).not.toHaveBeenCalled()
    expect(props.onError).not.toHaveBeenCalled()
  },
)

it('reports an approval failure and permits retry without claiming success', async () => {
  const user = userEvent.setup()
  mockApproveAccount.mockRejectedValueOnce(new Error('unexpected'))
  const props = makeProps()
  render(<AuthorizeAccount {...props} />)
  const approve = screen.getByRole('button', { name: 'deviceFlow.authorize.approve' })
  await user.click(approve)
  await waitFor(() => expect(props.onError).toHaveBeenCalledWith('deviceFlow.approveError.default'))
  expect(props.onApproved).not.toHaveBeenCalled()
  expect(approve).toBeEnabled()
  await user.click(approve)
  await waitFor(() => expect(props.onApproved).toHaveBeenCalledOnce())
  expect(mockApproveAccount).toHaveBeenCalledTimes(2)
})
