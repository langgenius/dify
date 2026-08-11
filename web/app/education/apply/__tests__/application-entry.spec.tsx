import { screen, waitFor } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import EducationApplyRoute from '../application-entry'

const mockReplace = vi.hoisted(() => vi.fn())
const mockProviderContext = vi.hoisted(() => ({
  enableEducationPlan: true,
  isFetchedPlanInfo: true,
}))
const mockSearchParams = vi.hoisted(() => ({ value: new URLSearchParams() }))

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: (selector: (state: typeof mockProviderContext) => unknown) =>
    selector(mockProviderContext),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams.value,
}))

vi.mock('@/app/education/paused-content', () => ({
  EducationPausedContent: () => <div>Education paused</div>,
}))

vi.mock('../application-form', () => ({
  default: ({ token }: { token: string }) => <div>Application form: {token}</div>,
}))

describe('EducationApplyRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderContext.enableEducationPlan = true
    mockProviderContext.isFetchedPlanInfo = true
    mockSearchParams.value = new URLSearchParams()
  })

  it('returns a tokenless URL to the verification entry', async () => {
    const { wrapper } = createConsoleQueryWrapper()

    render(<EducationApplyRoute />, { wrapper })

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/education/verify')
    })
  })

  it('renders the pause state for a direct token URL', () => {
    mockSearchParams.value = new URLSearchParams('token=education-token')
    const { wrapper } = createConsoleQueryWrapper({
      educationStatus: { is_student: false },
    })

    render(<EducationApplyRoute />, { wrapper })

    expect(screen.getByText('Education paused')).toBeInTheDocument()
    expect(screen.queryByText(/Application form/)).not.toBeInTheDocument()
  })
})
