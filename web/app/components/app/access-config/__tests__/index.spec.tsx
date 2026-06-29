import type { AccessRulesEditorProps } from '@/app/components/access-rules-editor'
import { screen } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { useStore } from '@/app/components/app/store'
import {
  useAppAccessRules,
  useAppUserAccessSettings,
} from '@/service/access-control/use-app-access-config'
import { AppACLPermission } from '@/utils/permission'
import AppAccessConfigPage from '../index'

const mockAppContext = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}))

let mockIsRbacEnabled = true

const render = (ui: Parameters<typeof renderWithSystemFeatures>[0]) => renderWithSystemFeatures(ui, {
  systemFeatures: {
    rbac_enabled: mockIsRbacEnabled,
  },
})

const mockAppAccessRules = vi.hoisted(() => ({
  items: [] as AccessRulesEditorProps['rules'],
  isLoading: false,
}))

const mockAppUserAccessSettings = vi.hoisted(() => ({
  data: [] as NonNullable<AccessRulesEditorProps['userAccessSettings']>,
  scope: 'specific' as AccessRulesEditorProps['openScope'],
  isLoading: false,
}))

const mockAccessRulesEditor = vi.hoisted(() => ({
  props: null as AccessRulesEditorProps | null,
}))

const mockMutations = vi.hoisted(() => ({
  updateOpenScope: vi.fn(),
  updateUserAccessSettings: vi.fn(),
  removeMemberBindings: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockAppContext,
}))

vi.mock('@/service/access-control/use-app-access-config', () => ({
  useAppAccessRules: vi.fn(() => ({
    data: { items: mockAppAccessRules.items },
    isLoading: mockAppAccessRules.isLoading,
  })),
  useAppUserAccessSettings: vi.fn(() => ({
    data: mockAppUserAccessSettings.scope
      ? { data: mockAppUserAccessSettings.data, scope: mockAppUserAccessSettings.scope }
      : undefined,
    isLoading: mockAppUserAccessSettings.isLoading,
  })),
  useUpdateAppOpenScope: vi.fn(() => ({
    mutate: mockMutations.updateOpenScope,
    isPending: false,
  })),
  useUpdateAppUserAccessSettings: vi.fn(() => ({
    mutate: mockMutations.updateUserAccessSettings,
  })),
  useRemoveAppAccessPolicyMemberBindings: vi.fn(() => ({
    mutate: mockMutations.removeMemberBindings,
  })),
}))

vi.mock('@/app/components/access-rules-editor', () => ({
  default: (props: AccessRulesEditorProps) => {
    mockAccessRulesEditor.props = props
    return (
      <div data-testid="access-rules-editor" />
    )
  },
}))

describe('AppAccessConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppContext.userProfile = { id: 'user-1' }
    mockAppContext.workspacePermissionKeys = []
    mockIsRbacEnabled = true
    mockAppAccessRules.items = []
    mockAppAccessRules.isLoading = false
    mockAppUserAccessSettings.data = []
    mockAppUserAccessSettings.scope = 'specific'
    mockAppUserAccessSettings.isLoading = false
    mockAccessRulesEditor.props = null
    useStore.setState({
      appDetail: {
        id: 'app-1',
        maintainer: 'account-1',
        permission_keys: [AppACLPermission.AccessConfig],
      } as NonNullable<ReturnType<typeof useStore.getState>['appDetail']>,
    })
  })

  // Rendering wires the app access rules into the shared editor.
  describe('Rendering', () => {
    it('should render access config title and pass app rules to the editor', () => {
      render(<AppAccessConfigPage appId="app-1" />)

      expect(screen.getByRole('heading', { name: 'common.settings.resourceAccess' })).toBeInTheDocument()
      expect(screen.getByText('permission.accessRule.appDescription')).toBeInTheDocument()
      expect(screen.getByTestId('access-rules-editor')).toBeInTheDocument()
      expect(mockAccessRulesEditor.props?.className).toBe('w-full max-w-200')
      expect(mockAccessRulesEditor.props?.rules).toEqual([])
      expect(mockAccessRulesEditor.props?.userAccessSettings).toEqual([])
      expect(mockAccessRulesEditor.props?.openScope).toBe('specific')
    })

    it('should not pass open scope before user access settings finish loading', () => {
      mockAppUserAccessSettings.scope = undefined
      mockAppUserAccessSettings.isLoading = true

      render(<AppAccessConfigPage appId="app-1" />)

      expect(mockAccessRulesEditor.props?.openScope).toBeUndefined()
    })

    it('should pass the user access settings open scope to the editor', () => {
      mockAppUserAccessSettings.scope = 'all'

      render(<AppAccessConfigPage appId="app-1" />)

      expect(mockAccessRulesEditor.props?.openScope).toBe('all')
    })

    it('should pass access rule loading state to the editor', () => {
      mockAppAccessRules.isLoading = true
      mockAppUserAccessSettings.isLoading = true

      render(<AppAccessConfigPage appId="app-1" />)

      expect(mockAccessRulesEditor.props?.isLoadingRules).toBe(true)
      expect(mockAccessRulesEditor.props?.isLoadingUserAccessSettings).toBe(true)
      expect(mockAccessRulesEditor.props?.isUpdatingOpenScope).toBe(true)
    })

    it('should pass the app maintainer id from app detail to the editor', () => {
      useStore.setState({
        appDetail: {
          id: 'app-1',
          maintainer: 'account-1',
          permission_keys: [AppACLPermission.AccessConfig],
        } as NonNullable<ReturnType<typeof useStore.getState>['appDetail']>,
      })

      render(<AppAccessConfigPage appId="app-1" />)

      expect(mockAccessRulesEditor.props?.maintainerId).toBe('account-1')
    })

    it('should wire open scope and user policy updates', () => {
      render(<AppAccessConfigPage appId="app-1" />)

      mockAccessRulesEditor.props?.onOpenScopeChange?.('all')
      expect(mockMutations.updateOpenScope).toHaveBeenCalledWith('all', expect.objectContaining({
        onError: expect.any(Function),
      }))

      mockAccessRulesEditor.props?.onUserAccessPoliciesChange?.('account-1', ['policy-1'])
      expect(mockMutations.updateUserAccessSettings).toHaveBeenCalledWith({
        accountId: 'account-1',
        accessPolicyIds: ['policy-1'],
      }, expect.objectContaining({
        onSettled: expect.any(Function),
      }))

      mockAccessRulesEditor.props?.onAddAccessSubject?.('account-2', ['default'])
      expect(mockMutations.updateUserAccessSettings).toHaveBeenCalledWith({
        accountId: 'account-2',
        accessPolicyIds: ['default'],
      }, expect.objectContaining({
        onSettled: expect.any(Function),
      }))

      mockAccessRulesEditor.props?.onRemoveAccessPolicyMemberBinding?.('account-3', 'policy-3')
      expect(mockMutations.removeMemberBindings).toHaveBeenCalledWith({
        accessPolicyId: 'policy-3',
        accountIds: ['account-3'],
      }, expect.objectContaining({
        onSettled: expect.any(Function),
      }))
    })

    it('should not mount access config data hooks when access config permission is missing', () => {
      useStore.setState({
        appDetail: {
          id: 'app-1',
          maintainer: 'account-1',
          permission_keys: [AppACLPermission.ViewLayout],
        } as NonNullable<ReturnType<typeof useStore.getState>['appDetail']>,
      })

      render(<AppAccessConfigPage appId="app-1" />)

      expect(screen.queryByTestId('access-rules-editor')).not.toBeInTheDocument()
      expect(useAppAccessRules).not.toHaveBeenCalled()
      expect(useAppUserAccessSettings).not.toHaveBeenCalled()
    })

    it('should not mount access config data hooks when RBAC is disabled', () => {
      mockIsRbacEnabled = false

      render(<AppAccessConfigPage appId="app-1" />)

      expect(screen.queryByTestId('access-rules-editor')).not.toBeInTheDocument()
      expect(useAppAccessRules).not.toHaveBeenCalled()
      expect(useAppUserAccessSettings).not.toHaveBeenCalled()
    })

    it('should allow the app maintainer with app management workspace permission', () => {
      mockAppContext.userProfile = { id: 'account-1' }
      mockAppContext.workspacePermissionKeys = ['app.create_and_management']
      useStore.setState({
        appDetail: {
          id: 'app-1',
          maintainer: 'account-1',
          permission_keys: [] as string[],
        } as NonNullable<ReturnType<typeof useStore.getState>['appDetail']>,
      })

      render(<AppAccessConfigPage appId="app-1" />)

      expect(screen.getByTestId('access-rules-editor')).toBeInTheDocument()
    })
  })
})
