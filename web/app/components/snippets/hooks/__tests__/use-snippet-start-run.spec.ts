import type { InputVar } from '@/models/pipeline'
import { act } from '@testing-library/react'
import {
  baseRunningData,
  renderWorkflowHook,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetDraftStore } from '../../draft-store'
import { useSnippetStartRun } from '../use-snippet-start-run'

const mockHandleCancelDebugAndPreviewPanel = vi.fn()
const mockHandleRun = vi.fn()
vi.mock('@/app/components/workflow/hooks/use-workflow-panel-interactions', () => ({
  useWorkflowInteractions: () => ({
    handleCancelDebugAndPreviewPanel: mockHandleCancelDebugAndPreviewPanel,
  }),
}))

const inputFields: InputVar[] = [
  {
    type: PipelineInputVarType.textInput,
    label: 'Query',
    variable: 'query',
    required: true,
  },
]

const renderStart = (initialStoreState = {}) =>
  renderWorkflowHook(() => useSnippetStartRun({ handleRun: mockHandleRun }), {
    resource: { kind: 'snippet', snippetId: 'snippet-1' },
    initialStoreState: { showEnvPanel: true, showGlobalVariablePanel: true, ...initialStoreState },
  })

beforeEach(() => {
  vi.resetAllMocks()
  useSnippetDraftStore.getState().reset()
})

it('uses the latest fields to open the input form and hides other variable panels', () => {
  const { result, store } = renderStart()
  // The fields can change after the run action is created.
  act(() => useSnippetDraftStore.getState().setInputFields(inputFields))
  act(() => result.current.handleWorkflowStartRunInWorkflow())

  expect(store.getState()).toMatchObject({
    showEnvPanel: false,
    showGlobalVariablePanel: false,
    showDebugAndPreviewPanel: true,
    showInputsPanel: true,
  })
  expect(mockHandleRun).not.toHaveBeenCalled()
})

it('runs immediately without leaving an old input form visible when there are no fields', () => {
  const { result, store } = renderStart({ showInputsPanel: true })
  act(() => result.current.handleWorkflowStartRunInWorkflow())

  expect(store.getState()).toMatchObject({ showDebugAndPreviewPanel: true, showInputsPanel: false })
  expect(mockHandleRun).toHaveBeenCalledExactlyOnceWith({ inputs: {} })
})

it('closes an already open debug panel without starting another run', () => {
  const { result } = renderStart({ showDebugAndPreviewPanel: true })
  act(() => result.current.handleWorkflowStartRunInWorkflow())

  expect(mockHandleCancelDebugAndPreviewPanel).toHaveBeenCalledOnce()
  expect(mockHandleRun).not.toHaveBeenCalled()
})

it('leaves panels and the active run unchanged while already running', () => {
  const { result, store } = renderStart({ workflowRunningData: baseRunningData() })
  act(() => result.current.handleWorkflowStartRunInWorkflow())

  expect(store.getState()).toMatchObject({
    showDebugAndPreviewPanel: false,
    showEnvPanel: true,
    showGlobalVariablePanel: true,
  })
  expect(mockHandleRun).not.toHaveBeenCalled()
  expect(mockHandleCancelDebugAndPreviewPanel).not.toHaveBeenCalled()
})
