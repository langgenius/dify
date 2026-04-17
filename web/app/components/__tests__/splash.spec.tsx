import type { MockedFunction } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useUserProfile } from '@/service/use-common'
import Splash from '../splash'

vi.mock('@/service/use-common', () => ({
  useUserProfile: vi.fn(),
}))

const mockUseUserProfile = useUserProfile as MockedFunction<typeof useUserProfile>

describe('Splash', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the loading indicator while the profile query is pending', () => {
    mockUseUserProfile.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
    } as ReturnType<typeof useUserProfile>)

    render(<Splash />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should not render the loading indicator when the profile query succeeds', () => {
    mockUseUserProfile.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        profile: { id: 'user-1' },
        meta: {
          currentVersion: '1.13.3',
          currentEnv: 'DEVELOPMENT',
        },
      },
    } as ReturnType<typeof useUserProfile>)

    render(<Splash />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('should stop rendering the loading indicator when the profile query errors', () => {
    mockUseUserProfile.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
      error: new Error('profile request failed'),
    } as ReturnType<typeof useUserProfile>)

    render(<Splash />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
