import type { LexicalEditor } from 'lexical'
import type { GetVarType } from '../../types'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { NodeOutPutVar, Var } from '@/app/components/workflow/types'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, waitFor } from '@testing-library/react'
import {
  $createParagraphNode,
  $getRoot,
  $nodesOfType,
} from 'lexical'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import {
  BlockEnum,
  InputVarType,
} from '@/app/components/workflow/types'
import { CustomTextNode } from '../custom-text/node'
import { CaptureEditorPlugin } from '../test-utils'
import HITLInputReplacementBlock from './hitl-input-block-replacement-block'
import { HITLInputNode } from './node'

const createWorkflowNodesMap = () => ({
  'node-1': {
    title: 'Start Node',
    type: BlockEnum.Start,
    height: 100,
    width: 120,
    position: { x: 0, y: 0 },
  },
})

const createFormInput = (): FormInputItem => ({
  type: InputVarType.paragraph,
  output_variable_name: 'user_name',
  default: {
    type: 'constant',
    selector: [],
    value: 'hello',
  },
})

const createVariables = (): NodeOutPutVar[] => {
  return [
    {
      nodeId: 'env',
      title: 'Env',
      vars: [{ variable: 'env.api_key', type: 'string' } as Var],
    },
    {
      nodeId: 'conversation',
      title: 'Conversation',
      vars: [{ variable: 'conversation.user_id', type: 'number' } as Var],
    },
    {
      nodeId: 'rag',
      title: 'RAG',
      vars: [{ variable: 'rag.shared.file_name', type: 'string', isRagVariable: true } as Var],
    },
    {
      nodeId: 'node-1',
      title: 'Node 1',
      vars: [
        { variable: 'node-1.ignore_me', type: 'string', isRagVariable: false } as Var,
        { variable: 'node-1.doc_name', type: 'string', isRagVariable: true } as Var,
      ],
    },
  ]
}

const renderReplacementPlugin = (props?: {
  variables?: NodeOutPutVar[]
  readonly?: boolean
  getVarType?: GetVarType
}) => {
  let editor: LexicalEditor | null = null

  const setEditor = (value: LexicalEditor) => {
    editor = value
  }

  const utils = render(
    <LexicalComposer
      initialConfig={{
        namespace: 'hitl-input-replacement-plugin-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: [CustomTextNode, HITLInputNode],
      }}
    >
      <HITLInputReplacementBlock
        nodeId="node-1"
        formInputs={[createFormInput()]}
        onFormInputsChange={vi.fn()}
        onFormInputItemRename={vi.fn()}
        onFormInputItemRemove={vi.fn()}
        workflowNodesMap={createWorkflowNodesMap()}
        variables={props?.variables}
        getVarType={props?.getVarType}
        readonly={props?.readonly}
      />
      <CaptureEditorPlugin onReady={setEditor} />
    </LexicalComposer>,
  )

  return {
    ...utils,
    getEditor: () => editor,
  }
}

const setEditorText = (editor: LexicalEditor, text: string) => {
  act(() => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()

      const paragraph = $createParagraphNode()
      paragraph.append(new CustomTextNode(text))
      root.append(paragraph)
      paragraph.selectEnd()
    })
  })
}

const getHITLInputNodes = (editor: LexicalEditor) => {
  let nodes: HITLInputNode[] = []

  editor.getEditorState().read(() => {
    nodes = $nodesOfType(HITLInputNode)
  })

  return nodes
}

type HITLInputNodeSnapshot = {
  variableName: string
  nodeId: string
  getVarType: GetVarType | undefined
  readonly: boolean
  environmentVariables: Var[]
  conversationVariables: Var[]
  ragVariables: Var[]
}

const readFirstHITLInputNodeSnapshot = (editor: LexicalEditor): HITLInputNodeSnapshot | null => {
  let snapshot: HITLInputNodeSnapshot | null = null
  editor.getEditorState().read(() => {
    const node = $nodesOfType(HITLInputNode)[0]
    if (!node)
      return

    snapshot = {
      variableName: node.getVariableName(),
      nodeId: node.getNodeId(),
      getVarType: node.getGetVarType(),
      readonly: node.getReadonly(),
      environmentVariables: node.getEnvironmentVariables(),
      conversationVariables: node.getConversationVariables(),
      ragVariables: node.getRagVariables(),
    }
  })

  return snapshot
}

describe('HITLInputReplacementBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Replacement behavior', () => {
    it('should replace matched output token with hitl input node and map variables from all supported sources', async () => {
      const getVarType: GetVarType = () => Type.string
      const { getEditor } = renderReplacementPlugin({
        variables: createVariables(),
        readonly: true,
        getVarType,
      })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      setEditorText(editor!, 'before {{#$output.user_name#}} after')

      await waitFor(() => {
        expect(getHITLInputNodes(editor!)).toHaveLength(1)
      })

      const node = readFirstHITLInputNodeSnapshot(editor!)
      expect(node).not.toBeNull()
      if (!node)
        throw new Error('Expected HITLInputNode snapshot')

      expect(node.variableName).toBe('user_name')
      expect(node.nodeId).toBe('node-1')
      expect(node.getVarType).toBe(getVarType)
      expect(node.readonly).toBe(true)
      expect(node.environmentVariables).toEqual([{ variable: 'env.api_key', type: 'string' }])
      expect(node.conversationVariables).toEqual([{ variable: 'conversation.user_id', type: 'number' }])
      expect(node.ragVariables).toEqual([
        { variable: 'rag.shared.file_name', type: 'string', isRagVariable: true },
        { variable: 'node-1.doc_name', type: 'string', isRagVariable: true },
      ])
    })

    it('should not replace text when no hitl output token exists', async () => {
      const { getEditor } = renderReplacementPlugin({
        variables: createVariables(),
      })

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      setEditorText(editor!, 'plain text without replacement token')

      await waitFor(() => {
        expect(getHITLInputNodes(editor!)).toHaveLength(0)
      })
    })

    it('should replace token with empty env conversation and rag lists when variables are not provided', async () => {
      const { getEditor } = renderReplacementPlugin()

      await waitFor(() => {
        expect(getEditor()).not.toBeNull()
      })

      const editor = getEditor()
      expect(editor).not.toBeNull()

      setEditorText(editor!, '{{#$output.user_name#}}')

      await waitFor(() => {
        expect(getHITLInputNodes(editor!)).toHaveLength(1)
      })

      const node = readFirstHITLInputNodeSnapshot(editor!)
      expect(node).not.toBeNull()
      if (!node)
        throw new Error('Expected HITLInputNode snapshot')

      expect(node.environmentVariables).toEqual([])
      expect(node.conversationVariables).toEqual([])
      expect(node.ragVariables).toEqual([])
      expect(node.readonly).toBe(false)
    })
  })

  describe('Node registration guard', () => {
    it('should throw when hitl input node is not registered on editor', () => {
      expect(() => {
        render(
          <LexicalComposer
            initialConfig={{
              namespace: 'hitl-input-replacement-plugin-missing-node-test',
              onError: (error: Error) => {
                throw error
              },
              nodes: [CustomTextNode],
            }}
          >
            <HITLInputReplacementBlock
              nodeId="node-1"
              formInputs={[createFormInput()]}
              onFormInputsChange={vi.fn()}
              onFormInputItemRename={vi.fn()}
              onFormInputItemRemove={vi.fn()}
              workflowNodesMap={createWorkflowNodesMap()}
            />
          </LexicalComposer>,
        )
      }).toThrow('HITLInputNodePlugin: HITLInputNode not registered on editor')
    })
  })
})
