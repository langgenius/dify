import { render, screen } from '@testing-library/react'
import FormContent from '../form'

const mockRoute = vi.hoisted(() => ({ token: 'v2-token' }))
const mockHumanInputV2Form = vi.hoisted(() =>
  vi.fn(({ token }: { token: string }) => <div>v2-form:{token}</div>),
)
const mockLegacyHook = vi.hoisted(() => vi.fn())

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: mockRoute.token }),
}))

vi.mock('@/features/human-input-v2-form/form', () => ({
  default: (props: { token: string }) => mockHumanInputV2Form(props),
}))

vi.mock('@/service/use-share', () => ({
  useGetHumanInputForm: mockLegacyHook,
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

describe('/form-v2/[token] route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRoute.token = 'v2-token'
  })

  it('passes the v2 route token to the isolated feature and never invokes the legacy form hook', () => {
    render(<FormContent />)

    expect(screen.getByText('v2-form:v2-token')).toBeInTheDocument()
    expect(mockHumanInputV2Form).toHaveBeenCalledWith({ token: 'v2-token' })
    expect(mockLegacyHook).not.toHaveBeenCalled()
  })

  it('keys the feature session by the current route token', () => {
    const { unmount } = render(<FormContent />)
    unmount()
    mockRoute.token = 'next-token'
    render(<FormContent />)

    expect(screen.getByText('v2-form:next-token')).toBeInTheDocument()
    expect(mockHumanInputV2Form).toHaveBeenLastCalledWith({ token: 'next-token' })
  })
})
