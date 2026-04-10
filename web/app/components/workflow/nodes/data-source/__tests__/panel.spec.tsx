import type { ReactNode } from 'react'
import type { DataSourceNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import useMatchSchemaType, { getMatchedSchemaType } from '../../_base/components/variable/use-match-schema-type'
import ToolForm from '../../tool/components/tool-form'
import { useConfig } from '../hooks/use-config'
import Panel from '../panel'

const mockWrapStructuredVarItem = vi.hoisted(() => vi.fn((payload: unknown) => payload))

vi.mock('@/app/components/base/tag-input', () => ({
  __esModule: true,
  default: ({
    items,
    onChange,
    placeholder,
  }: {
    items: string[]
    onChange: (items: string[]) => void
    placeholder?: string
  }) => (
    <button type="button" onClick={() => onChange([...items, 'txt'])}>
      {placeholder}
    </button>
  ),
}))

vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  toolParametersToFormSchemas: vi.fn(),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: vi.fn(),
}))

vi.mock('@/app/components/workflow/utils/tool', () => ({
  wrapStructuredVarItem: (payload: unknown) => mockWrapStructuredVarItem(payload),
}))

vi.mock('../../_base/components/output-vars', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  VarItem: ({ name, type }: { name: string, type: string }) => <div>{`${name}:${type}`}</div>,
}))

vi.mock('../../_base/components/variable/object-child-tree-panel/show', () => ({
  __esModule: true,
  default: ({ payload }: { payload: { name: string } }) => <div>{payload.name}</div>,
}))

vi.mock('../../_base/components/variable/use-match-schema-type', () => ({
  __esModule: true,
  default: vi.fn(),
  getMatchedSchemaType: vi.fn(),
}))

vi.mock('../../tool/components/tool-form', () => ({
  __esModule: true,
  default: vi.fn(({ onChange, onManageInputField }: { onChange: (value: unknown) => void, onManageInputField?: () => void }) => (
    <div>
      <button type="button" onClick={() => onChange({ dataset: 'docs' })}>tool-form-change</button>
      <button type="button" onClick={() => onManageInputField?.()}>manage-input-field</button>
    </div>
  )),
}))

vi.mock('../hooks/use-config', () => ({
  useConfig: vi.fn(),
}))

const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseStore = vi.mocked(useStore)
const mockUseConfig = vi.mocked(useConfig)
const mockToolParametersToFormSchemas = vi.mocked(toolParametersToFormSchemas)
const mockUseMatchSchemaType = vi.mocked(useMatchSchemaType)
const mockGetMatchedSchemaType = vi.mocked(getMatchedSchemaType)
const mockToolForm = vi.mocked(ToolForm)

const setShowInputFieldPanel = vi.fn()

const createData = (overrides: Partial<DataSourceNodeType> = {}): DataSourceNodeType => ({
  title: 'Datasource',
  desc: '',
  type: BlockEnum.DataSource,
  plugin_id: 'plugin-1',
  provider_type: 'remote',
  provider_name: 'provider',
  datasource_name: 'source-a',
  datasource_label: 'Source A',
  datasource_parameters: {},
  datasource_configurations: {},
  fileExtensions: ['pdf'],
  ...overrides,
})

const panelProps = {} as NodePanelProps<DataSourceNodeType>['panelProps']

describe('data-source/panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })
    mockUseStore.mockImplementation((selector) => {
      const select = selector as (state: unknown) => unknown
      return select({
        dataSourceList: [{
          plugin_id: 'plugin-1',
          is_authorized: true,
          tools: [{
            name: 'source-a',
            parameters: [{ name: 'dataset' }],
          }],
        }],
        pipelineId: 'pipeline-1',
        setShowInputFieldPanel,
      })
    })
    mockUseConfig.mockReturnValue({
      handleFileExtensionsChange: vi.fn(),
      handleParametersChange: vi.fn(),
      outputSchema: [],
      hasObjectOutput: false,
    })
    mockToolParametersToFormSchemas.mockReturnValue([{ name: 'dataset' }] as never)
    mockUseMatchSchemaType.mockReturnValue({ schemaTypeDefinitions: {} } as ReturnType<typeof useMatchSchemaType>)
    mockGetMatchedSchemaType.mockReturnValue('')
  })

  it('renders the authorized tool form path and forwards parameter changes', () => {
    const handleParametersChange = vi.fn()
    mockUseConfig.mockReturnValueOnce({
      handleFileExtensionsChange: vi.fn(),
      handleParametersChange,
      outputSchema: [{
        name: 'metadata',
        value: { type: 'object' },
      }],
      hasObjectOutput: true,
    })
    mockGetMatchedSchemaType.mockReturnValueOnce('json')

    render(
      <Panel
        id="data-source-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'tool-form-change' }))
    fireEvent.click(screen.getByRole('button', { name: 'manage-input-field' }))

    expect(handleParametersChange).toHaveBeenCalledWith({ dataset: 'docs' })
    expect(setShowInputFieldPanel).toHaveBeenCalledWith(true)
    expect(mockToolForm).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'data-source-node',
      showManageInputField: true,
      value: {},
    }), undefined)
    expect(screen.getByText('metadata')).toBeInTheDocument()
  })

  it('renders the local-file path and updates supported file extensions', () => {
    const handleFileExtensionsChange = vi.fn()
    mockUseConfig.mockReturnValueOnce({
      handleFileExtensionsChange,
      handleParametersChange: vi.fn(),
      outputSchema: [],
      hasObjectOutput: false,
    })

    render(
      <Panel
        id="data-source-node"
        data={createData({ provider_type: 'local_file' })}
        panelProps={panelProps}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.dataSource.supportedFileFormatsPlaceholder' }))

    expect(handleFileExtensionsChange).toHaveBeenCalledWith(['pdf', 'txt'])
    expect(screen.getByText(`datasource_type:${VarType.string}`)).toBeInTheDocument()
    expect(screen.getByText(`file:${VarType.file}`)).toBeInTheDocument()
  })
})
