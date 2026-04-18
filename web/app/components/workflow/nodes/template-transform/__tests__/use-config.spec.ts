import type { TemplateTransformNodeType } from '../types'
import type { Variable } from '@/app/components/workflow/types'
import { renderHook, waitFor } from '@testing-library/react'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import useVarList from '../../_base/hooks/use-var-list'
import useConfig from '../use-config'

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('../../_base/hooks/use-var-list', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseStore = vi.mocked(useStore)
const mockUseNodeCrud = vi.mocked(useNodeCrud)
const mockUseAvailableVarList = vi.mocked(useAvailableVarList)
const mockUseVarList = vi.mocked(useVarList)

const doSetInputs = vi.fn()
const handleAddEmptyVariable = vi.fn()

const createVariable = (overrides: Partial<Variable> = {}): Variable => ({
  variable: 'input_text',
  value_selector: ['node-1', 'input_text'],
  value_type: VarType.string,
  ...overrides,
})

const createData = (overrides: Partial<TemplateTransformNodeType> = {}): TemplateTransformNodeType => ({
  title: 'Template Transform',
  desc: '',
  type: BlockEnum.TemplateTransform,
  variables: [createVariable()],
  template: '{{ input_text }}',
  ...overrides,
})

describe('template-transform/use-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })
    mockUseStore.mockImplementation((selector) => {
      const select = selector as (state: unknown) => unknown
      return select({
        nodesDefaultConfigs: {
          [BlockEnum.TemplateTransform]: {
            template: '{{ default_input }}',
            variables: [createVariable({ variable: 'default_input', value_selector: ['node-2', 'default_input'] })],
          },
        },
      })
    })
    mockUseAvailableVarList.mockReturnValue({
      availableVars: [['node-1', { variable: 'input_text', type: VarType.string }]],
      availableNodes: [],
      availableNodesWithParent: [],
    } as unknown as ReturnType<typeof useAvailableVarList>)
    mockUseVarList.mockReturnValue({
      handleAddVariable: handleAddEmptyVariable,
      handleVarListChange: vi.fn(),
    } as unknown as ReturnType<typeof useVarList>)
  })

  it('hydrates default config when the template is empty', async () => {
    mockUseNodeCrud.mockReturnValue({
      inputs: createData({ template: '', variables: [] }),
      setInputs: doSetInputs,
    } as ReturnType<typeof useNodeCrud>)

    renderHook(() => useConfig('template-node', createData({ template: '', variables: [] })))

    await waitFor(() => {
      expect(doSetInputs).toHaveBeenCalledWith(expect.objectContaining({
        template: '{{ default_input }}',
      }))
    })
  })

  it('updates variables, template text, and renamed placeholders', () => {
    mockUseNodeCrud.mockReturnValue({
      inputs: createData(),
      setInputs: doSetInputs,
    } as ReturnType<typeof useNodeCrud>)

    const { result } = renderHook(() => useConfig('template-node', createData()))
    const nextVariable = createVariable({ variable: 'renamed_input', value_selector: ['node-2', 'renamed_input'] })

    result.current.handleVarListChange([nextVariable])
    result.current.handleAddVariable(createVariable({ variable: 'extra_input', value_selector: ['node-3', 'extra_input'] }))
    result.current.handleVarNameChange('input_text', 'renamed_input')
    result.current.handleCodeChange('{{ output }}')

    expect(result.current.availableVars).toEqual([['node-1', { variable: 'input_text', type: VarType.string }]])
    expect(result.current.handleAddEmptyVariable).toBe(handleAddEmptyVariable)
    expect(doSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      variables: [nextVariable],
    }))
    expect(doSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.arrayContaining([
        expect.objectContaining({ variable: 'renamed_input' }),
        expect.objectContaining({ variable: 'extra_input' }),
      ]),
    }))
    expect(doSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      template: '{{ renamed_input }}',
    }))
    expect(doSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      template: '{{ output }}',
    }))
  })

  it('filters to scalar and collection variables used by template interpolation', () => {
    mockUseNodeCrud.mockReturnValue({
      inputs: createData(),
      setInputs: doSetInputs,
    } as ReturnType<typeof useNodeCrud>)

    const { result } = renderHook(() => useConfig('template-node', createData()))

    expect(result.current.readOnly).toBe(false)
    expect(result.current.filterVar({ type: VarType.string } as never)).toBe(true)
    expect(result.current.filterVar({ type: VarType.arrayObject } as never)).toBe(true)
    expect(result.current.filterVar({ type: VarType.file } as never)).toBe(false)
  })
})
