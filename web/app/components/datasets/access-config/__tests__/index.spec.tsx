import type { AccessRulesEditorProps } from '@/app/components/access-rules-editor'
import { render, screen } from '@testing-library/react'
import DatasetAccessConfigPage from '../index'

const mockDatasetAccessRules = vi.hoisted(() => ({
  items: [] as AccessRulesEditorProps['rules'],
  isLoading: false,
}))

const mockDatasetPermissionKeys = vi.hoisted(() => ({
  value: [] as string[],
}))

const mockAccessRulesEditor = vi.hoisted(() => ({
  props: null as AccessRulesEditorProps | null,
}))

vi.mock('@/service/access-control/use-dataset-access-config', () => ({
  useDatasetAccessRules: vi.fn(() => ({
    data: { items: mockDatasetAccessRules.items },
    isLoading: mockDatasetAccessRules.isLoading,
  })),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: <T,>(selector: (state: { dataset?: { permission_keys?: string[] } }) => T): T => selector({
    dataset: { permission_keys: mockDatasetPermissionKeys.value },
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

describe('DatasetAccessConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasetAccessRules.items = []
    mockDatasetAccessRules.isLoading = false
    mockDatasetPermissionKeys.value = []
    mockAccessRulesEditor.props = null
  })

  // Rendering wires dataset access rules into the shared editor.
  describe('Rendering', () => {
    it('should render access config title and pass dataset id to the editor', () => {
      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      expect(screen.getByRole('heading', { name: 'common.settings.knowledgeBaseAccessPermissions' })).toBeInTheDocument()
      expect(screen.getByTestId('access-rules-editor')).toHaveTextContent('dataset-1:false')
      expect(mockAccessRulesEditor.props?.rules).toEqual([])
    })

    it('should pass access rule loading state to the editor', () => {
      mockDatasetAccessRules.isLoading = true

      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      expect(mockAccessRulesEditor.props?.isLoadingRules).toBe(true)
    })

    it('should allow management when dataset ACL includes access config permission', () => {
      mockDatasetPermissionKeys.value = ['dataset.acl.access_config']

      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      expect(mockAccessRulesEditor.props?.canManage).toBe(true)
    })
  })
})
