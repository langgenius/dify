import type { AccessRulesEditorProps } from '@/app/components/access-rules-editor'
import { render, screen } from '@testing-library/react'
import { useStore } from '@/app/components/app/store'
import AppAccessConfigPage from '../index'

const mockAppAccessRules = vi.hoisted(() => ({
  items: [] as AccessRulesEditorProps['rules'],
  isLoading: false,
}))

const mockAppUserAccessSettings = vi.hoisted(() => ({
  data: [] as NonNullable<AccessRulesEditorProps['userAccessSettings']>,
  isLoading: false,
}))

const mockAppOpenScope = vi.hoisted(() => ({
  scope: 'specific' as AccessRulesEditorProps['openScope'] | undefined,
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

vi.mock('@/service/access-control/use-app-access-config', () => ({
  useAppAccessRules: vi.fn(() => ({
    data: { items: mockAppAccessRules.items },
    isLoading: mockAppAccessRules.isLoading,
  })),
  useAppUserAccessSettings: vi.fn(() => ({
    data: { data: mockAppUserAccessSettings.data },
    isLoading: mockAppUserAccessSettings.isLoading,
  })),
  useAppOpenScope: vi.fn(() => ({
    data: mockAppOpenScope.scope ? { scope: mockAppOpenScope.scope } : undefined,
    isLoading: mockAppOpenScope.isLoading,
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
    mockAppAccessRules.items = []
    mockAppAccessRules.isLoading = false
    mockAppUserAccessSettings.data = []
    mockAppUserAccessSettings.isLoading = false
    mockAppOpenScope.scope = 'specific'
    mockAppOpenScope.isLoading = false
    mockAccessRulesEditor.props = null
    useStore.setState({ appDetail: undefined })
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

    it('should not pass open scope before the scope request finishes', () => {
      mockAppOpenScope.scope = undefined
      mockAppOpenScope.isLoading = true

      render(<AppAccessConfigPage appId="app-1" />)

      expect(mockAccessRulesEditor.props?.openScope).toBeUndefined()
    })

    it('should pass the fetched open scope to the editor', () => {
      mockAppOpenScope.scope = 'all'

      render(<AppAccessConfigPage appId="app-1" />)

      expect(mockAccessRulesEditor.props?.openScope).toBe('all')
    })

    it('should pass access rule loading state to the editor', () => {
      mockAppAccessRules.isLoading = true
      mockAppUserAccessSettings.isLoading = true
      mockAppOpenScope.isLoading = true

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
  })
})
