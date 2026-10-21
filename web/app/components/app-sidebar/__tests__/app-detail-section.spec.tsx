import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { screen } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'
import AppDetailSection from '../app-detail-section'

let mockAppMode: AppDetailWithSite['mode'] = 'chat'
let mockPathname = '/app/app-1/logs'
let mockAppPermissionKeys: string[] = []
let mockIsRbacEnabled = true
let mockHasPublishedWorkflow = true
let mockDeploymentEdition: DeploymentEdition = 'ENTERPRISE'
const render = (ui: Parameters<typeof renderWithConsoleQuery>[0]) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
    createAppDetailFixture({
      id: 'app-1',
      name: 'Test App',
      mode: mockAppMode,
      permission_keys: mockAppPermissionKeys,
      workflow: mockHasPublishedWorkflow
        ? { id: 'workflow-1', created_at: 1, updated_at: 1 }
        : null,
    }),
  )
  return renderWithConsoleQuery(ui, {
    queryClient,
    accountProfile: { id: 'user-1' },
    workspacePermissionKeys: [],
    systemFeatures: {
      deployment_edition: mockDeploymentEdition,
      rbac_enabled: mockIsRbacEnabled,
      enable_app_deploy: false,
    },
  })
}

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
  useSelectedLayoutSegment: () => mockPathname.split('/').pop(),
}))

vi.mock('../app-info', () => ({
  AppInfoView: () => <div />,
}))

describe('AppDetailSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppMode = 'chat'
    mockPathname = '/app/app-1/logs'
    mockAppPermissionKeys = [AppACLPermission.Monitor]
    mockIsRbacEnabled = true
    mockHasPublishedWorkflow = true
    mockDeploymentEdition = 'ENTERPRISE'
  })

  // Rendering behavior for app detail navigation entries.
  describe('Rendering', () => {
    it('should render only overview for chat apps with app monitor permission', () => {
      mockAppMode = 'chat'

      render(<AppDetailSection />)

      expect(screen.getByRole('link', { name: 'common.appMenus.overview' })).toHaveAttribute(
        'href',
        '/app/app-1/overview',
      )
      expect(screen.queryByRole('link', { name: 'common.appMenus.logs' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.annotations' }),
      ).not.toBeInTheDocument()
    })

    it('should render logs and annotations for chat apps with app log and annotation permission', () => {
      mockAppMode = 'chat'
      mockAppPermissionKeys = [AppACLPermission.LogAndAnnotation]

      render(<AppDetailSection />)

      expect(screen.getByRole('link', { name: 'common.appMenus.logs' })).toHaveAttribute(
        'href',
        '/app/app-1/logs',
      )
      expect(screen.getByRole('link', { name: 'common.appMenus.annotations' })).toHaveAttribute(
        'href',
        '/app/app-1/annotations',
      )
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.overview' }),
      ).not.toBeInTheDocument()
    })

    it('should only render logs navigation for workflow apps', () => {
      mockAppMode = 'workflow'
      mockAppPermissionKeys = [AppACLPermission.LogAndAnnotation]

      render(<AppDetailSection />)

      expect(screen.getByRole('link', { name: 'common.appMenus.logs' })).toHaveAttribute(
        'href',
        '/app/app-1/logs',
      )
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.annotations' }),
      ).not.toBeInTheDocument()
    })

    it('should only render logs navigation for completion apps', () => {
      mockAppMode = 'completion'
      mockAppPermissionKeys = [AppACLPermission.LogAndAnnotation]

      render(<AppDetailSection />)

      expect(screen.getByRole('link', { name: 'common.appMenus.logs' })).toHaveAttribute(
        'href',
        '/app/app-1/logs',
      )
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.annotations' }),
      ).not.toBeInTheDocument()
    })

    it('should render the layout navigation for users with view layout permission', () => {
      mockAppPermissionKeys = [AppACLPermission.ViewLayout]

      render(<AppDetailSection />)

      expect(screen.getByRole('link', { name: 'common.appMenus.promptEng' })).toHaveAttribute(
        'href',
        '/app/app-1/configuration',
      )
      expect(screen.queryByRole('link', { name: 'common.appMenus.logs' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.annotations' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.overview' }),
      ).not.toBeInTheDocument()
    })

    it('should hide the layout navigation when layout access is missing', () => {
      render(<AppDetailSection />)

      expect(
        screen.queryByRole('link', { name: 'common.appMenus.promptEng' }),
      ).not.toBeInTheDocument()
    })

    it('shows evaluation for a published workflow with layout view permission', () => {
      mockAppMode = 'workflow'
      mockAppPermissionKeys = [AppACLPermission.ViewLayout]

      render(<AppDetailSection />)

      expect(screen.getByRole('link', { name: 'evaluation.title' })).toHaveAttribute(
        'href',
        '/app/app-1/evaluation',
      )
    })

    it('shows disabled evaluation before the workflow is published', () => {
      mockAppMode = 'workflow'
      mockAppPermissionKeys = [AppACLPermission.ViewLayout]
      mockHasPublishedWorkflow = false

      render(<AppDetailSection />)

      expect(screen.getByRole('button', { name: 'evaluation.title' })).toBeDisabled()
      expect(screen.queryByRole('link', { name: 'evaluation.title' })).not.toBeInTheDocument()
    })

    it('hides evaluation for other app modes', () => {
      mockAppMode = 'advanced-chat'
      mockAppPermissionKeys = [AppACLPermission.ViewLayout]

      render(<AppDetailSection />)

      expect(screen.queryByText('evaluation.title')).not.toBeInTheDocument()
    })

    it('should hide evaluation in the community edition', () => {
      mockAppMode = 'workflow'
      mockAppPermissionKeys = [AppACLPermission.ViewLayout]
      mockDeploymentEdition = 'COMMUNITY'

      render(<AppDetailSection />)

      expect(screen.queryByText('evaluation.title')).not.toBeInTheDocument()
    })

    it('should render access point navigation using its app route', () => {
      mockAppPermissionKeys = [AppACLPermission.AccessPointView]

      render(<AppDetailSection />)

      expect(screen.getByRole('link', { name: 'common.appMenus.accessPoint' })).toHaveAttribute(
        'href',
        '/app/app-1/access-point',
      )
      expect(
        screen.queryByRole('link', { name: 'common.appMenus.apiAccess' }),
      ).not.toBeInTheDocument()
    })

    it('should hide access point navigation without view permission', () => {
      render(<AppDetailSection />)

      expect(
        screen.queryByRole('link', { name: 'common.appMenus.accessPoint' }),
      ).not.toBeInTheDocument()
    })

    it.each(['workflow', 'advanced-chat'] as const)(
      'should render deploy navigation for a %s app with app deploy ACL regardless of the legacy workspace role',
      (mode) => {
        mockAppMode = mode
        mockAppPermissionKeys = [AppACLPermission.Deploy]

        render(<AppDetailSection />)

        expect(screen.getByRole('link', { name: 'common.appMenus.deploy' })).toHaveAttribute(
          'href',
          '/app/app-1/deploy',
        )
      },
    )

    it.each([
      {
        label: 'the app is not a workflow app',
        mode: 'chat' as const,
        permissionKeys: [AppACLPermission.Deploy],
      },
      {
        label: 'app deploy ACL permission is missing',
        mode: 'workflow' as const,
        permissionKeys: [AppACLPermission.Monitor],
      },
    ] as const)('should hide deploy navigation when $label', ({ mode, permissionKeys }) => {
      mockAppMode = mode
      mockAppPermissionKeys = [...permissionKeys]

      render(<AppDetailSection />)

      expect(screen.queryByRole('link', { name: 'common.appMenus.deploy' })).not.toBeInTheDocument()
    })

    it.each(['chat', 'agent-chat'] as const)(
      'should render resource access navigation for %s apps when app access config permission is granted',
      (mode) => {
        mockAppMode = mode
        mockAppPermissionKeys = [AppACLPermission.AccessConfig]

        render(<AppDetailSection />)

        expect(
          screen.getByRole('link', { name: 'navigation.settings.resourceAccess' }),
        ).toHaveAttribute('href', '/app/app-1/access-config')
        expect(
          screen.queryByRole('link', { name: 'common.appMenus.overview' }),
        ).not.toBeInTheDocument()
      },
    )

    it('should hide resource access navigation for Agent apps', () => {
      mockAppMode = 'agent'
      mockAppPermissionKeys = [AppACLPermission.AccessConfig]

      render(<AppDetailSection />)

      expect(
        screen.queryByRole('link', { name: 'navigation.settings.resourceAccess' }),
      ).not.toBeInTheDocument()
    })

    it('should hide resource access navigation when app access config permission is missing', () => {
      render(<AppDetailSection />)

      expect(
        screen.queryByRole('link', { name: 'navigation.settings.resourceAccess' }),
      ).not.toBeInTheDocument()
    })

    it('should hide resource access navigation when RBAC is disabled', () => {
      mockIsRbacEnabled = false
      mockAppPermissionKeys = [AppACLPermission.AccessConfig]

      render(<AppDetailSection />)

      expect(
        screen.queryByRole('link', { name: 'navigation.settings.resourceAccess' }),
      ).not.toBeInTheDocument()
    })
  })
})
