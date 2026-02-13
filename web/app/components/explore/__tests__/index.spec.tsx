import type { Mock } from 'vitest'
import type { CurrentTryAppParams } from '@/context/explore-context'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useContext } from 'use-context-selector'
import { useAppContext } from '@/context/app-context'
import ExploreContext from '@/context/explore-context'
import { MediaType } from '@/hooks/use-breakpoints'
import useDocumentTitle from '@/hooks/use-document-title'
import { useMembers } from '@/service/use-common'
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

const ContextReader = ({ triggerTryPanel }: { triggerTryPanel?: boolean }) => {
  const { hasEditPermission, setShowTryAppPanel, isShowTryAppPanel, currentApp } = useContext(ExploreContext)
  return (
    <div>
      {hasEditPermission ? 'edit-yes' : 'edit-no'}
      {isShowTryAppPanel && <span data-testid="try-panel-open">open</span>}
      {currentApp && <span data-testid="current-app">{currentApp.appId}</span>}
      {triggerTryPanel && (
        <>
          <button data-testid="show-try" onClick={() => setShowTryAppPanel(true, { appId: 'test-app' } as CurrentTryAppParams)}>show</button>
          <button data-testid="hide-try" onClick={() => setShowTryAppPanel(false)}>hide</button>
        </>
      )}
    </div>
  )
}

describe('Explore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render children and provide edit permission from members role', async () => {
      ; (useAppContext as Mock).mockReturnValue({
        userProfile: { id: 'user-1' },
        isCurrentWorkspaceDatasetOperator: false,
      });
      (useMembers as Mock).mockReturnValue({
        data: {
          accounts: [{ id: 'user-1', role: 'admin' }],
        },
      })

      render((
        <Explore>
          <ContextReader />
        </Explore>
      ))

      await waitFor(() => {
        expect(screen.getByText('edit-yes')).toBeInTheDocument()
      })
    })
  })

  describe('Effects', () => {
    it('should set document title on render', () => {
      ; (useAppContext as Mock).mockReturnValue({
        userProfile: { id: 'user-1' },
        isCurrentWorkspaceDatasetOperator: false,
      });
      (useMembers as Mock).mockReturnValue({ data: { accounts: [] } })

      render((
        <Explore>
          <div>child</div>
        </Explore>
      ))

      expect(useDocumentTitle).toHaveBeenCalledWith('common.menus.explore')
    })

    it('should redirect dataset operators to /datasets', async () => {
      ; (useAppContext as Mock).mockReturnValue({
        userProfile: { id: 'user-1' },
        isCurrentWorkspaceDatasetOperator: true,
      });
      (useMembers as Mock).mockReturnValue({ data: { accounts: [] } })

      render((
        <Explore>
          <div>child</div>
        </Explore>
      ))

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/datasets')
      })
    })

    it('should skip permission check when membersData has no accounts', () => {
      ; (useAppContext as Mock).mockReturnValue({
        userProfile: { id: 'user-1' },
        isCurrentWorkspaceDatasetOperator: false,
      });
      (useMembers as Mock).mockReturnValue({ data: undefined })

      render((
        <Explore>
          <ContextReader />
        </Explore>
      ))

      expect(screen.getByText('edit-no')).toBeInTheDocument()
    })
  })

  describe('Context: setShowTryAppPanel', () => {
    it('should set currentApp params when showing try panel', async () => {
      ; (useAppContext as Mock).mockReturnValue({
        userProfile: { id: 'user-1' },
        isCurrentWorkspaceDatasetOperator: false,
      });
      (useMembers as Mock).mockReturnValue({ data: { accounts: [] } })

      render((
        <Explore>
          <ContextReader triggerTryPanel />
        </Explore>
      ))

      fireEvent.click(screen.getByTestId('show-try'))

      await waitFor(() => {
        expect(screen.getByTestId('try-panel-open')).toBeInTheDocument()
        expect(screen.getByTestId('current-app')).toHaveTextContent('test-app')
      })
    })

    it('should clear currentApp params when hiding try panel', async () => {
      ; (useAppContext as Mock).mockReturnValue({
        userProfile: { id: 'user-1' },
        isCurrentWorkspaceDatasetOperator: false,
      });
      (useMembers as Mock).mockReturnValue({ data: { accounts: [] } })

      render((
        <Explore>
          <ContextReader triggerTryPanel />
        </Explore>
      ))

      fireEvent.click(screen.getByTestId('show-try'))
      await waitFor(() => {
        expect(screen.getByTestId('try-panel-open')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('hide-try'))
      await waitFor(() => {
        expect(screen.queryByTestId('try-panel-open')).not.toBeInTheDocument()
        expect(screen.queryByTestId('current-app')).not.toBeInTheDocument()
      })
    })
  })
})
