import type { LexicalEditor } from 'lexical'
import type { WorkflowNodesMap } from '../workflow-variable-block/node'
import type { Var } from '@/app/components/workflow/types'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, screen, waitFor } from '@testing-library/react'
import {
  $getRoot,
} from 'lexical'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import {
  BlockEnum,
} from '@/app/components/workflow/types'
import { CaptureEditorPlugin } from '../test-utils'
import { UPDATE_WORKFLOW_NODES_MAP } from '../workflow-variable-block'
import { HITLInputNode } from './node'
import HITLInputVariableBlockComponent from './variable-block'

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

const hasErrorIcon = (container: HTMLElement) => {
  return container.querySelector('svg.text-text-destructive') !== null
}

const renderVariableBlock = (props: {
  variables: string[]
  workflowNodesMap?: WorkflowNodesMap
  getVarType?: (payload: { nodeId: string, valueSelector: string[] }) => Type
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
      expect(hasErrorIcon(container)).toBe(true)

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
        handled = editor!.dispatchCommand(UPDATE_WORKFLOW_NODES_MAP, createWorkflowNodesMap())
      })

      expect(handled).toBe(true)
      await waitFor(() => {
        expect(screen.getByText('Node One')).toBeInTheDocument()
      })
    })
  })

  describe('Validation branches', () => {
    it('should show invalid state for env variable when environment list does not contain selector', () => {
      const { container } = renderVariableBlock({
        variables: ['env', 'api_key'],
        workflowNodesMap: {},
        environmentVariables: [],
      })

      expect(hasErrorIcon(container)).toBe(true)
    })

    it('should keep conversation variable valid when selector exists in conversation variables', () => {
      const { container } = renderVariableBlock({
        variables: ['conversation', 'session_id'],
        workflowNodesMap: {},
        conversationVariables: [{ variable: 'conversation.session_id', type: 'string' } as Var],
      })

      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should keep global system variable valid without workflow node mapping', () => {
      const { container } = renderVariableBlock({
        variables: ['sys', 'global_name'],
        workflowNodesMap: {},
      })

      expect(screen.getByText('sys.global_name')).toBeInTheDocument()
      expect(hasErrorIcon(container)).toBe(false)
    })
  })

  describe('Tooltip payload', () => {
    it('should call getVarType with rag selector and use rag node id mapping', () => {
      const getVarType = vi.fn(() => Type.number)
      const { container } = renderVariableBlock({
        variables: ['rag', 'node-rag', 'chunk'],
        workflowNodesMap: createWorkflowNodesMap(),
        ragVariables: [{ variable: 'rag.node-rag.chunk', type: 'string', isRagVariable: true } as Var],
        getVarType,
      })

      expect(screen.getByText('chunk')).toBeInTheDocument()
      expect(hasErrorIcon(container)).toBe(false)
      expect(getVarType).toHaveBeenCalledWith({
        nodeId: 'rag',
        valueSelector: ['rag', 'node-rag', 'chunk'],
      })
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
