import type { AccessRulesEditorProps } from '@/app/components/access-rules-editor'
import { render, screen } from '@testing-library/react'
import AppAccessConfigPage from '../index'

const mockAppAccessRules = vi.hoisted(() => ({
  items: [] as AccessRulesEditorProps['rules'],
  isLoading: false,
}))

const mockAppPermissionKeys = vi.hoisted(() => ({
  value: [] as string[],
}))

const mockAccessRulesEditor = vi.hoisted(() => ({
  props: null as AccessRulesEditorProps | null,
}))

vi.mock('@/service/access-control/use-app-access-config', () => ({
  useAppAccessRules: vi.fn(() => ({
    data: { items: mockAppAccessRules.items },
    isLoading: mockAppAccessRules.isLoading,
  })),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: <T,>(selector: (state: { appDetail?: { permission_keys?: string[] } }) => T): T => selector({
    appDetail: { permission_keys: mockAppPermissionKeys.value },
  }),
}))

vi.mock('@/app/components/access-rules-editor', () => ({
  default: (props: AccessRulesEditorProps) => {
    mockAccessRulesEditor.props = props
    return (
      <div data-testid="access-rules-editor">
        {props.resourceId}
        :
        {String(props.canManage)}
      </div>
    )
  },
}))

describe('AppAccessConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppAccessRules.items = []
    mockAppAccessRules.isLoading = false
    mockAppPermissionKeys.value = []
    mockAccessRulesEditor.props = null
  })

  // Rendering wires the app access rules into the shared editor.
  describe('Rendering', () => {
    it('should render access config title and pass app id to the editor', () => {
      render(<AppAccessConfigPage appId="app-1" />)

      expect(screen.getByRole('heading', { name: 'common.settings.appAccessPermissions' })).toBeInTheDocument()
      expect(screen.getByTestId('access-rules-editor')).toHaveTextContent('app-1:false')
      expect(mockAccessRulesEditor.props?.rules).toEqual([])
    })

    it('should pass access rule loading state to the editor', () => {
      mockAppAccessRules.isLoading = true

      render(<AppAccessConfigPage appId="app-1" />)

      expect(mockAccessRulesEditor.props?.isLoadingRules).toBe(true)
    })

    it('should allow management when app ACL includes access config permission', () => {
      mockAppPermissionKeys.value = ['app.acl.access_config']

      render(<AppAccessConfigPage appId="app-1" />)

      expect(mockAccessRulesEditor.props?.canManage).toBe(true)
    })
  })
})
