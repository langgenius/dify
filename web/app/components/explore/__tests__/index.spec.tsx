import { render, screen } from '@testing-library/react'
import { MediaType } from '@/hooks/use-breakpoints'
import Explore from '../index'

const mockReplace = vi.fn()
const mockPush = vi.fn()
const mockInstalledAppsData = { installed_apps: [] as const }
type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType]

let mockMediaType: MediaTypeValue = MediaType.pc

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/explore',
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
  useSelectedLayoutSegments: () => ['apps'],
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => mockMediaType,
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
}))

vi.mock('@/service/use-explore', () => ({
  useGetInstalledApps: () => ({
    isPending: false,
    data: mockInstalledAppsData,
  }),
  useUninstallApp: () => ({
    mutateAsync: vi.fn(),
  }),
  useUpdateAppPinStatus: () => ({
    mutateAsync: vi.fn(),
  }),
}))

describe('Explore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMediaType = MediaType.pc
  })

  describe('Rendering', () => {
    it('should render children', () => {
      render(
        <Explore>
          <div>child</div>
        </Explore>,
      )

      expect(screen.getByText('child')).toBeInTheDocument()
    })

    it('should not render the legacy explore sidebar on desktop', () => {
      render(
        <Explore>
          <div>child</div>
        </Explore>,
      )

      expect(screen.queryByText('explore.sidebar.title')).not.toBeInTheDocument()
    })

    it('should keep the legacy explore sidebar on mobile', () => {
      mockMediaType = MediaType.mobile

      render(
        <Explore>
          <div>child</div>
        </Explore>,
      )

      expect(screen.getByRole('link', { name: 'explore.sidebar.title' })).toBeInTheDocument()
    })
  })

  describe('Effects', () => {
    it('should not redirect at component level', () => {
      render(
        <Explore>
          <div>child</div>
        </Explore>,
      )

      expect(mockReplace).not.toHaveBeenCalled()
    })

    it('should not redirect on mobile', () => {
      mockMediaType = MediaType.mobile

      render(
        <Explore>
          <div>child</div>
        </Explore>,
      )

      expect(mockReplace).not.toHaveBeenCalled()
    })
  })
})
