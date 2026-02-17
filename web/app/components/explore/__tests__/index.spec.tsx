import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useAppContext } from '@/context/app-context'
import { MediaType } from '@/hooks/use-breakpoints'
import Explore from '../index'

const mockReplace = vi.fn()
const mockPush = vi.fn()
const mockInstalledAppsData = { installed_apps: [] as const }

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
  useSelectedLayoutSegments: () => ['apps'],
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => MediaType.pc,
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

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

describe('Explore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useAppContext as Mock).mockReturnValue({
      isCurrentWorkspaceDatasetOperator: false,
    })
  })

  describe('Rendering', () => {
    it('should render children', () => {
      render((
        <Explore>
          <div>child</div>
        </Explore>
      ))

      expect(screen.getByText('child')).toBeInTheDocument()
    })
  })

  describe('Effects', () => {
    it('should not redirect dataset operators at component level', async () => {
      ;(useAppContext as Mock).mockReturnValue({
        isCurrentWorkspaceDatasetOperator: true,
      })

      render((
        <Explore>
          <div>child</div>
        </Explore>
      ))

      await waitFor(() => {
        expect(mockReplace).not.toHaveBeenCalled()
      })
    })

    it('should not redirect non dataset operators', () => {
      render((
        <Explore>
          <div>child</div>
        </Explore>
      ))

      expect(mockReplace).not.toHaveBeenCalled()
    })
  })
})
