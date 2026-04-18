import type { LexicalEditor } from 'lexical'
import type { WorkflowNodesMap } from '../../workflow-variable-block/node'
import type { Var } from '@/app/components/workflow/types'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, screen, waitFor } from '@testing-library/react'
import {
  $getRoot,
} from 'lexical'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import {
  BlockEnum,
  VarType,
} from '@/app/components/workflow/types'
import { CaptureEditorPlugin } from '../../test-utils'
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

const createSelectorWithTransientPrefix = (prefix: string, suffix: string): string[] => {
  let accessCount = 0
  const selector = [prefix, suffix]
  return new Proxy(selector, {
    get(target, property, receiver) {
      if (property === '0') {
        accessCount += 1
        return accessCount > 4 ? undefined : prefix
      }
      return Reflect.get(target, property, receiver)
    },
  }) as unknown as string[]
}

const hasErrorIcon = (container: HTMLElement) => {
  return container.querySelector('svg.text-text-warning') !== null
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
        conversationVariables: [createVar('conversation.session_id')],
      })

      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should show valid state when conversation variables array is undefined', () => {
      const { container } = renderVariableBlock({
        variables: ['conversation', 'session_id'],
        workflowNodesMap: {},
        conversationVariables: undefined,
      })

      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should show valid state when env variables array is undefined', () => {
      const { container } = renderVariableBlock({
        variables: ['env', 'api_key'],
        workflowNodesMap: {},
        environmentVariables: undefined,
      })

      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should show valid state when rag variables array is undefined', () => {
      const { container } = renderVariableBlock({
        variables: ['rag', 'node-rag', 'chunk'],
        workflowNodesMap: createWorkflowNodesMap(),
        ragVariables: undefined,
      })

      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should validate env variable when matching entry exists in multi-element array', () => {
      const { container } = renderVariableBlock({
        variables: ['env', 'api_key'],
        workflowNodesMap: {},
        environmentVariables: [
          { variable: 'env.other_key', type: 'string' } as Var,
          { variable: 'env.api_key', type: 'string' } as Var,
        ],
      })
      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should validate conversation variable when matching entry exists in multi-element array', () => {
      const { container } = renderVariableBlock({
        variables: ['conversation', 'session_id'],
        workflowNodesMap: {},
        conversationVariables: [
          { variable: 'conversation.other', type: 'string' } as Var,
          { variable: 'conversation.session_id', type: 'string' } as Var,
        ],
      })
      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should validate rag variable when matching entry exists in multi-element array', () => {
      const { container } = renderVariableBlock({
        variables: ['rag', 'node-rag', 'chunk'],
        workflowNodesMap: createWorkflowNodesMap(),
        ragVariables: [
          { variable: 'rag.node-rag.other', type: 'string', isRagVariable: true } as Var,
          { variable: 'rag.node-rag.chunk', type: 'string', isRagVariable: true } as Var,
        ],
      })
      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should handle undefined indices in variables array gracefully', () => {
      // Testing the `variables?.[1] ?? ''` fallback logic
      const { container: envContainer } = renderVariableBlock({
        variables: ['env'], // missing second part
        workflowNodesMap: {},
        environmentVariables: [{ variable: 'env.', type: 'string' } as Var],
      })
      expect(hasErrorIcon(envContainer)).toBe(false)

      const { container: chatContainer } = renderVariableBlock({
        variables: ['conversation'],
        workflowNodesMap: {},
        conversationVariables: [{ variable: 'conversation.', type: 'string' } as Var],
      })
      expect(hasErrorIcon(chatContainer)).toBe(false)

      const { container: ragContainer } = renderVariableBlock({
        variables: ['rag', 'node-rag'], // missing third part
        workflowNodesMap: createWorkflowNodesMap(),
        ragVariables: [{ variable: 'rag.node-rag.', type: 'string', isRagVariable: true } as Var],
      })
      expect(hasErrorIcon(ragContainer)).toBe(false)
    })

    it('should keep global system variable valid without workflow node mapping', () => {
      const { container } = renderVariableBlock({
        variables: ['sys', 'global_name'],
        workflowNodesMap: {},
      })

      expect(screen.getByText('sys.global_name')).toBeInTheDocument()
      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should format system variable names with sys. prefix correctly', () => {
      const { container } = renderVariableBlock({
        variables: ['sys', 'query'],
        workflowNodesMap: {},
      })
      // 'query' exception variable is valid sys variable
      expect(screen.getByText('query')).toBeInTheDocument()
      expect(hasErrorIcon(container)).toBe(true)
    })

    it('should apply exception styling for recognized exception variables', () => {
      renderVariableBlock({
        variables: ['node-1', 'error_message'],
        workflowNodesMap: createWorkflowNodesMap(),
      })
      expect(screen.getByText('error_message')).toBeInTheDocument()
      expect(screen.getByTestId('exception-variable')).toBeInTheDocument()
    })
  })

  describe('Tooltip payload', () => {
    it('should call getVarType with rag selector and use rag node id mapping', () => {
      const getVarType = vi.fn(() => Type.number)
      const { container } = renderVariableBlock({
        variables: ['rag', 'node-rag', 'chunk'],
        workflowNodesMap: createWorkflowNodesMap(),
        ragVariables: [{ ...createVar('rag.node-rag.chunk'), isRagVariable: true }],
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

  describe('Optional lists and selector fallbacks', () => {
    it('should keep env variable valid when environmentVariables is not provided', () => {
      const { container } = renderVariableBlock({
        variables: ['env', 'api_key'],
        workflowNodesMap: {},
      })

      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should evaluate env selector fallback when selector second segment is missing', () => {
      const { container } = renderVariableBlock({
        variables: ['env'],
        workflowNodesMap: {},
        environmentVariables: [createVar('env.')],
      })

      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should evaluate env selector fallback when selector prefix becomes undefined at lookup time', () => {
      const { container } = renderVariableBlock({
        variables: createSelectorWithTransientPrefix('env', 'api_key'),
        workflowNodesMap: {},
        environmentVariables: [createVar('.api_key')],
      })

      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should keep conversation variable valid when conversationVariables is not provided', () => {
      const { container } = renderVariableBlock({
        variables: ['conversation', 'session_id'],
        workflowNodesMap: {},
      })

      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should evaluate conversation selector fallback when selector second segment is missing', () => {
      const { container } = renderVariableBlock({
        variables: ['conversation'],
        workflowNodesMap: {},
        conversationVariables: [createVar('conversation.')],
      })

      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should keep rag variable valid when ragVariables is not provided', () => {
      const { container } = renderVariableBlock({
        variables: ['rag', 'node-rag', 'chunk'],
        workflowNodesMap: createWorkflowNodesMap(),
      })

      expect(hasErrorIcon(container)).toBe(false)
    })

    it('should evaluate rag selector fallbacks when node and key segments are missing', () => {
      const { container } = renderVariableBlock({
        variables: ['rag'],
        workflowNodesMap: {},
        ragVariables: [createVar('rag..')],
      })

      expect(hasErrorIcon(container)).toBe(false)
    })
  })
})
