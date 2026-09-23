import { screen } from '@testing-library/react'
import { createConsoleQueryWrapper, seedFeatures } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import EducationApplyRoute from '../application-entry'

const mockRedirect = vi.hoisted(() => vi.fn(() => null as never))

vi.mock('@/next/navigation', () => ({
  redirect: mockRedirect,
}))

vi.mock('../application-form', () => ({
  default: ({ token }: { token: string }) => <div>Application form: {token}</div>,
}))

describe('EducationApplyRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns to home when the education plan is unavailable', () => {
    const { queryClient, wrapper } = createConsoleQueryWrapper()
    seedFeatures(queryClient, { education: { enabled: false } })

    render(<EducationApplyRoute token="education-token" />, { wrapper })

    expect(mockRedirect).toHaveBeenCalledWith('/')
  })

  it('renders the application form for a direct token URL', () => {
    const { queryClient, wrapper } = createConsoleQueryWrapper({
      educationStatus: { is_student: false },
    })
    seedFeatures(queryClient, {
      billing: { subscription: { plan: 'sandbox' } },
      education: { enabled: true },
    })

    render(<EducationApplyRoute token="education-token" />, { wrapper })

    expect(screen.getByText('Application form: education-token')).toBeInTheDocument()
  })
})
