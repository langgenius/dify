import type { DocExtractorNodeType } from '../types'
import { renderHook } from '@testing-library/react'
import { useStoreApi } from 'reactflow'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import useConfig from '../use-config'

const mockUseStoreApi = vi.mocked(useStoreApi)
const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseNodeCrud = vi.mocked(useNodeCrud)
const mockUseIsChatMode = vi.mocked(useIsChatMode)
const mockUseWorkflow = vi.mocked(useWorkflow)
const mockUseWorkflowVariables = vi.mocked(useWorkflowVariables)

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    useStoreApi: vi.fn(),
  }
})

vi.mock('@/app/components/workflow/hooks', () => ({
  useIsChatMode: vi.fn(),
  useNodesReadOnly: vi.fn(),
  useWorkflow: vi.fn(),
  useWorkflowVariables: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const setInputs = vi.fn()
const getCurrentVariableType = vi.fn()

const createData = (overrides: Partial<DocExtractorNodeType> = {}): DocExtractorNodeType => ({
  title: 'Document Extractor',
  desc: '',
  type: BlockEnum.DocExtractor,
  variable_selector: ['node-1', 'files'],
  is_array_file: false,
  ...overrides,
})

describe('document-extractor/use-config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })
    mockUseIsChatMode.mockReturnValue(false)
    mockUseWorkflow.mockReturnValue({
      getBeforeNodesInSameBranch: vi.fn(() => [{ id: 'start-node' }]),
    } as unknown as ReturnType<typeof useWorkflow>)
    mockUseWorkflowVariables.mockReturnValue({
      getCurrentVariableType,
    } as unknown as ReturnType<typeof useWorkflowVariables>)
    mockUseStoreApi.mockReturnValue({
      getState: () => ({
        getNodes: () => [
          { id: 'doc-node', parentId: 'loop-1', data: { type: BlockEnum.DocExtractor } },
          { id: 'loop-1', data: { type: BlockEnum.Loop } },
        ],
      }),
    } as ReturnType<typeof useStoreApi>)
    mockUseNodeCrud.mockReturnValue({
      inputs: createData(),
      setInputs,
    } as ReturnType<typeof useNodeCrud>)
  })

  it('updates the selected variable and tracks array file output types', () => {
    getCurrentVariableType.mockReturnValue(VarType.arrayFile)

    const { result } = renderHook(() => useConfig('doc-node', createData()))

    result.current.handleVarChanges(['node-2', 'files'])

    expect(getCurrentVariableType).toHaveBeenCalled()
    expect(setInputs).toHaveBeenCalledWith(expect.objectContaining({
      variable_selector: ['node-2', 'files'],
      is_array_file: true,
    }))
  })

  it('only accepts file variables in the picker filter', () => {
    const { result } = renderHook(() => useConfig('doc-node', createData()))

    expect(result.current.readOnly).toBe(false)
    expect(result.current.filterVar({ type: VarType.file } as never)).toBe(true)
    expect(result.current.filterVar({ type: VarType.arrayFile } as never)).toBe(true)
    expect(result.current.filterVar({ type: VarType.string } as never)).toBe(false)
  })
})
