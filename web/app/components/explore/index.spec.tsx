import type { Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useContext } from 'use-context-selector'
import { useAppContext } from '@/context/app-context'
import ExploreContext from '@/context/explore-context'
import { MediaType } from '@/hooks/use-breakpoints'
import useDocumentTitle from '@/hooks/use-document-title'
import { useMembers } from '@/service/use-common'
import Explore from './index'

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
    isFetching: false,
    data: mockInstalledAppsData,
    refetch: vi.fn(),
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

vi.mock('@/service/use-common', () => ({
  useMembers: vi.fn(),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

const ContextReader = () => {
  const { hasEditPermission } = useContext(ExploreContext)
  return <div>{hasEditPermission ? 'edit-yes' : 'edit-no'}</div>
}

describe('Explore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: provides ExploreContext and children.
  describe('Rendering', () => {
    it('should render children and provide edit permission from members role', async () => {
      // Arrange
      ; (useAppContext as Mock).mockReturnValue({
        userProfile: { id: 'user-1' },
        isCurrentWorkspaceDatasetOperator: false,
      });
      (useMembers as Mock).mockReturnValue({
        data: {
          accounts: [{ id: 'user-1', role: 'admin' }],
        },
      })

      // Act
      render((
        <Explore>
          <ContextReader />
        </Explore>
      ))

      // Assert
      await waitFor(() => {
        expect(screen.getByText('edit-yes')).toBeInTheDocument()
      })
    })
  })

  // Effects: set document title and redirect dataset operators.
  describe('Effects', () => {
    it('should set document title on render', () => {
      // Arrange
      ; (useAppContext as Mock).mockReturnValue({
        userProfile: { id: 'user-1' },
        isCurrentWorkspaceDatasetOperator: false,
      });
      (useMembers as Mock).mockReturnValue({ data: { accounts: [] } })

      // Act
      render((
        <Explore>
          <div>child</div>
        </Explore>
      ))

      // Assert
      expect(useDocumentTitle).toHaveBeenCalledWith('common.menus.explore')
    })

    it('should redirect dataset operators to /datasets', async () => {
      // Arrange
      ; (useAppContext as Mock).mockReturnValue({
        userProfile: { id: 'user-1' },
        isCurrentWorkspaceDatasetOperator: true,
      });
      (useMembers as Mock).mockReturnValue({ data: { accounts: [] } })

      // Act
      render((
        <Explore>
          <div>child</div>
        </Explore>
      ))

      // Assert
      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/datasets')
      })
    })
  })
})
