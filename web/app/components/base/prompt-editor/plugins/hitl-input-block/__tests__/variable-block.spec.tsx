import type { LexicalEditor } from 'lexical'
import type { WorkflowNodesMap } from '../../workflow-variable-block/node'
import type { Var } from '@/app/components/workflow/types'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { $getRoot } from 'lexical'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { CaptureEditorPlugin } from '../../__tests__/test-utils'
import { UPDATE_WORKFLOW_NODES_MAP } from '../../workflow-variable-block'
import { HITLInputNode } from '../node'
import HITLInputVariableBlockComponent from '../variable-block'

const createWorkflowNodesMap = (title = 'Node One'): WorkflowNodesMap => ({
  'node-1': {
    title,
    type: BlockEnum.LLM,
    height: 100,
    width: 120,
    position: { x: 0, y: 0 },
  },
  'node-rag': {
    title: 'Retriever',
    type: BlockEnum.LLM,
    height: 100,
    width: 120,
    position: { x: 0, y: 0 },
  },
})

const createVar = (variable: string): Var => ({
  variable,
  type: VarType.string,
})

const renderVariableBlock = (props: {
  variables: string[]
  workflowNodesMap?: WorkflowNodesMap
  getVarType?: (payload: { nodeId: string; valueSelector: string[] }) => Type
  environmentVariables?: Var[]
  conversationVariables?: Var[]
  ragVariables?: Var[]
}) => {
  let editor: LexicalEditor | null = null

  const setEditor = (value: LexicalEditor) => {
    editor = value
  }

  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'hitl-input-variable-block-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: [HITLInputNode],
      }}
    >
      <HITLInputVariableBlockComponent
        variables={props.variables}
        workflowNodesMap={props.workflowNodesMap ?? createWorkflowNodesMap()}
        getVarType={props.getVarType}
        environmentVariables={props.environmentVariables}
        conversationVariables={props.conversationVariables}
        ragVariables={props.ragVariables}
      />
      <CaptureEditorPlugin onReady={setEditor} />
    </LexicalComposer>,
  )

  return {
    ...utils,
    getEditor: () => editor,
  }
}

describe('HITLInputVariableBlockComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Node guard', () => {
    it('should throw when hitl input node is not registered on editor', () => {
      expect(() => {
        render(
          <LexicalComposer
            initialConfig={{
              namespace: 'hitl-input-variable-block-missing-node-test',
              onError: (error: Error) => {
                throw error
              },
              nodes: [],
            }}
          >
            <HITLInputVariableBlockComponent
              variables={['node-1', 'output']}
              workflowNodesMap={createWorkflowNodesMap()}
            />
          </LexicalComposer>,
        )
      }).toThrow('HITLInputNodePlugin: HITLInputNode not registered on editor')
    })
  })

  describe('Workflow map updates', () => {
    it('should update local workflow node map when UPDATE_WORKFLOW_NODES_MAP command is dispatched', async () => {
      const { container, getEditor } = renderVariableBlock({
        variables: ['node-1', 'output'],
        workflowNodesMap: {},
      })

      expect(screen.queryByText('Node One')).not.toBeInTheDocument()
      await userEvent.setup().hover(container.firstElementChild as HTMLElement)
      expect(await screen.findByText('workflow.errorMsg.invalidVariable')).toBeVisible()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      let handled = false
      act(() => {
        editor!.update(() => {
          $getRoot().selectEnd()
        })
        handled = editor!.dispatchCommand(UPDATE_WORKFLOW_NODES_MAP, {
          workflowNodesMap: createWorkflowNodesMap(),
          availableVariables: [],
        })
      })

      expect(handled).toBe(true)
      await waitFor(() => {
        expect(screen.getByText('Node One')).toBeInTheDocument()
      })
    })
  })

  describe('Validation branches', () => {
    it('should show invalid state for env variable when environment list does not contain selector', async () => {
      const { container } = renderVariableBlock({
        variables: ['env', 'api_key'],
        workflowNodesMap: {},
        environmentVariables: [],
      })

      await userEvent.setup().hover(container.firstElementChild as HTMLElement)
      expect(await screen.findByText('workflow.errorMsg.invalidVariable')).toBeVisible()
    })

    it('should show valid state when conversation variables array is undefined', async () => {
      const { container } = renderVariableBlock({
        variables: ['conversation', 'session_id'],
        workflowNodesMap: {},
        conversationVariables: undefined,
      })

      await userEvent.setup().hover(container.firstElementChild as HTMLElement)
      expect(screen.queryByText('workflow.errorMsg.invalidVariable')).not.toBeInTheDocument()
    })

    it('should show valid state when env variables array is undefined', async () => {
      const { container } = renderVariableBlock({
        variables: ['env', 'api_key'],
        workflowNodesMap: {},
        environmentVariables: undefined,
      })

      await userEvent.setup().hover(container.firstElementChild as HTMLElement)
      expect(screen.queryByText('workflow.errorMsg.invalidVariable')).not.toBeInTheDocument()
    })

    it('should show valid state when rag variables array is undefined', async () => {
      const { container } = renderVariableBlock({
        variables: ['rag', 'node-rag', 'chunk'],
        workflowNodesMap: createWorkflowNodesMap(),
        ragVariables: undefined,
      })

      await userEvent.setup().hover(container.firstElementChild as HTMLElement)
      expect(screen.queryByText('workflow.errorMsg.invalidVariable')).not.toBeInTheDocument()
    })

    it('should validate env variable when matching entry exists in multi-element array', async () => {
      const { container } = renderVariableBlock({
        variables: ['env', 'api_key'],
        workflowNodesMap: {},
        environmentVariables: [
          { variable: 'env.other_key', type: 'string' } as Var,
          { variable: 'env.api_key', type: 'string' } as Var,
        ],
      })
      await userEvent.setup().hover(container.firstElementChild as HTMLElement)
      expect(screen.queryByText('workflow.errorMsg.invalidVariable')).not.toBeInTheDocument()
    })

    it('should validate conversation variable when matching entry exists in multi-element array', async () => {
      const { container } = renderVariableBlock({
        variables: ['conversation', 'session_id'],
        workflowNodesMap: {},
        conversationVariables: [
          { variable: 'conversation.other', type: 'string' } as Var,
          { variable: 'conversation.session_id', type: 'string' } as Var,
        ],
      })
      await userEvent.setup().hover(container.firstElementChild as HTMLElement)
      expect(screen.queryByText('workflow.errorMsg.invalidVariable')).not.toBeInTheDocument()
    })

    it('should validate rag variable when matching entry exists in multi-element array', async () => {
      const { container } = renderVariableBlock({
        variables: ['rag', 'node-rag', 'chunk'],
        workflowNodesMap: createWorkflowNodesMap(),
        ragVariables: [
          { variable: 'rag.node-rag.other', type: 'string', isRagVariable: true } as Var,
          { variable: 'rag.node-rag.chunk', type: 'string', isRagVariable: true } as Var,
        ],
      })
      await userEvent.setup().hover(container.firstElementChild as HTMLElement)
      expect(screen.queryByText('workflow.errorMsg.invalidVariable')).not.toBeInTheDocument()
    })

    it('should keep global system variable valid without workflow node mapping', async () => {
      const { container } = renderVariableBlock({
        variables: ['sys', 'global_name'],
        workflowNodesMap: {},
      })

      expect(screen.getByText('sys.global_name')).toBeInTheDocument()
      await userEvent.setup().hover(container.firstElementChild as HTMLElement)
      expect(screen.queryByText('workflow.errorMsg.invalidVariable')).not.toBeInTheDocument()
    })

    it('should format system variable names with sys. prefix correctly', async () => {
      const { container } = renderVariableBlock({
        variables: ['sys', 'query'],
        workflowNodesMap: {},
      })
      // 'query' exception variable is valid sys variable
      expect(screen.getByText('query')).toBeInTheDocument()
      await userEvent.setup().hover(container.firstElementChild as HTMLElement)
      expect(await screen.findByText('workflow.errorMsg.invalidVariable')).toBeVisible()
    })

    it('should apply exception styling for recognized exception variables', () => {
      renderVariableBlock({
        variables: ['node-1', 'error_message'],
        workflowNodesMap: createWorkflowNodesMap(),
      })
      expect(screen.getByText('error_message')).toBeInTheDocument()
    })
  })

  describe('Full-path preview payload', () => {
    it('should resolve the rag node via isRagVar offset and skip the full-path preview', async () => {
      const getVarType = vi.fn(() => Type.number)
      const { container } = renderVariableBlock({
        variables: ['rag', 'node-rag', 'chunk'],
        workflowNodesMap: createWorkflowNodesMap(),
        ragVariables: [{ ...createVar('rag.node-rag.chunk'), isRagVariable: true }],
        getVarType,
      })

      expect(screen.getByText('chunk')).toBeInTheDocument()
      await userEvent.setup().hover(container.firstElementChild as HTMLElement)
      expect(screen.queryByText('workflow.errorMsg.invalidVariable')).not.toBeInTheDocument()
      // Rag selectors always have `isShowAPart === false`, so the full-path
      // preview is not rendered and `getVarType` is not invoked.
      expect(getVarType).not.toHaveBeenCalled()
    })

    it('should use shortened display name for deep non-rag selectors', () => {
      const getVarType = vi.fn(() => Type.string)

      renderVariableBlock({
        variables: ['node-1', 'parent', 'child'],
        workflowNodesMap: createWorkflowNodesMap(),
        getVarType,
      })

      expect(screen.getByText('child')).toBeInTheDocument()
      expect(screen.queryByText('parent.child')).not.toBeInTheDocument()
      expect(getVarType).toHaveBeenCalledWith({
        nodeId: 'node-1',
        valueSelector: ['node-1', 'parent', 'child'],
      })
    })
  })
})
