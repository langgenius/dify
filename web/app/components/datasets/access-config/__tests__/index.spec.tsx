import type { AccessRulesEditorProps } from '@/app/components/access-rules-editor'
import { render, screen } from '@testing-library/react'
import DatasetAccessConfigPage from '../index'

const mockDatasetAccessRules = vi.hoisted(() => ({
  items: [] as AccessRulesEditorProps['rules'],
  isLoading: false,
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

vi.mock('@/app/components/access-rules-editor', () => ({
  default: (props: AccessRulesEditorProps) => {
    mockAccessRulesEditor.props = props
    return (
      <div data-testid="access-rules-editor">
        {props.title}
      </div>
    )
  },
}))

describe('DatasetAccessConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasetAccessRules.items = []
    mockDatasetAccessRules.isLoading = false
    mockAccessRulesEditor.props = null
  })

  // Rendering wires dataset access rules into the shared editor.
  describe('Rendering', () => {
    it('should render access config title and pass dataset rules to the editor', () => {
      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      expect(screen.getByRole('heading', { name: 'common.settings.resourceAccess' })).toBeInTheDocument()
      expect(screen.getByTestId('access-rules-editor')).toHaveTextContent('permission.accessRule.datasetTitle')
      expect(mockAccessRulesEditor.props?.rules).toEqual([])
    })

    it('should pass access rule loading state to the editor', () => {
      mockDatasetAccessRules.isLoading = true

      render(<DatasetAccessConfigPage datasetId="dataset-1" />)

      expect(mockAccessRulesEditor.props?.isLoadingRules).toBe(true)
    })
  })
})
