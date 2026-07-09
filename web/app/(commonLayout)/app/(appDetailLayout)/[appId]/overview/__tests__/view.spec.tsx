import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { AppACLPermission } from '@/utils/permission'
import OverviewView from '../view'

const testState = vi.hoisted(() => ({
  appDetail: {
    id: 'app-1',
    mode: 'chat',
    maintainer: 'maintainer-1',
    permission_keys: [] as string[],
  },
  currentUserId: 'user-1',
  workspacePermissionKeys: [] as string[],
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: <T,>(selector: (state: { appDetail: typeof testState.appDetail }) => T): T => selector({
    appDetail: testState.appDetail,
  }),
}))

vi.mock('@/app/components/app/overview/apikey-info-panel', () => ({
  default: () => <div>api key info panel</div>,
}))

vi.mock('../chart-view', () => ({
  default: ({ appId, headerRight }: { appId: string, headerRight: ReactNode }) => (
    <div>
      chart view
      {' '}
      {appId}
      {headerRight}
    </div>
  ),
}))

vi.mock('../tracing/panel', () => ({
  default: () => <button type="button">tracing</button>,
}))

describe('OverviewView monitor permission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.appDetail = {
      id: 'app-1',
      mode: 'chat',
      maintainer: 'maintainer-1',
      permission_keys: [],
    }
    testState.currentUserId = 'user-1'
    testState.workspacePermissionKeys = []
  })

  // The overview page should be controlled as one monitor-permission surface.
  describe('Permissions', () => {
    it('should not render overview page content when app monitor permission is missing', () => {
      render(<OverviewView appId="app-1" />)

      expect(screen.queryByText('api key info panel')).not.toBeInTheDocument()
      expect(screen.queryByText(/chart view app-1/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'tracing' })).not.toBeInTheDocument()
    })

    it('should render overview page content without tracing entry when only app monitor permission is granted', () => {
      testState.appDetail.permission_keys = [AppACLPermission.Monitor]

      render(<OverviewView appId="app-1" />)

      expect(screen.getByText('api key info panel')).toBeInTheDocument()
      expect(screen.getByText(/chart view app-1/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'tracing' })).not.toBeInTheDocument()
    })

    it('should render tracing entry when app tracing config permission is granted with monitor access', () => {
      testState.appDetail.permission_keys = [AppACLPermission.Monitor, AppACLPermission.TracingConfig]

      render(<OverviewView appId="app-1" />)

      expect(screen.getByText('api key info panel')).toBeInTheDocument()
      expect(screen.getByText(/chart view app-1/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'tracing' })).toBeInTheDocument()
    })

    it('should not render overview page content when only app tracing config permission is granted', () => {
      testState.appDetail.permission_keys = [AppACLPermission.TracingConfig]

      render(<OverviewView appId="app-1" />)

      expect(screen.queryByText('api key info panel')).not.toBeInTheDocument()
      expect(screen.queryByText(/chart view app-1/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'tracing' })).not.toBeInTheDocument()
    })
  })
})
