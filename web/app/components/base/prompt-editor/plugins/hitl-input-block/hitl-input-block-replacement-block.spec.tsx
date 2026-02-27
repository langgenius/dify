import type { LexicalEditor } from 'lexical'
import type { GetVarType } from '../../types'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { NodeOutPutVar, Var } from '@/app/components/workflow/types'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, waitFor } from '@testing-library/react'
import { $nodesOfType } from 'lexical'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import {
  BlockEnum,
  InputVarType,
} from '@/app/components/workflow/types'
import { CustomTextNode } from '../custom-text/node'
import {
  getNodesByType,
  readEditorStateValue,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '../test-helpers'
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
  formInputs?: FormInputItem[] | null
}) => {
  const formInputs = props?.formInputs === null ? undefined : (props?.formInputs ?? [createFormInput()])

  return renderLexicalEditor({
    namespace: 'hitl-input-replacement-plugin-test',
    nodes: [CustomTextNode, HITLInputNode],
    children: (
      <HITLInputReplacementBlock
        nodeId="node-1"
        formInputs={formInputs}
        onFormInputsChange={vi.fn()}
        onFormInputItemRename={vi.fn()}
        onFormInputItemRemove={vi.fn()}
        workflowNodesMap={createWorkflowNodesMap()}
        variables={props?.variables}
        getVarType={props?.getVarType}
        readonly={props?.readonly}
      />
    ),
  })
}

type HITLInputNodeSnapshot = {
  variableName: string
  nodeId: string
  getVarType: GetVarType | undefined
  readonly: boolean
  environmentVariables: Var[]
  conversationVariables: Var[]
  ragVariables: Var[]
  formInputsLength: number
}

const readFirstHITLInputNodeSnapshot = (editor: LexicalEditor): HITLInputNodeSnapshot | null => {
  return readEditorStateValue(editor, () => {
    const node = $nodesOfType(HITLInputNode)[0]
    if (!node)
      return null

    return {
      variableName: node.getVariableName(),
      nodeId: node.getNodeId(),
      getVarType: node.getGetVarType(),
      readonly: node.getReadonly(),
      environmentVariables: node.getEnvironmentVariables(),
      conversationVariables: node.getConversationVariables(),
      ragVariables: node.getRagVariables(),
      formInputsLength: node.getFormInputs().length,
    }
  })
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

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, 'before {{#$output.user_name#}} after', text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodesByType(editor, HITLInputNode)).toHaveLength(1)
      })

      const node = readFirstHITLInputNodeSnapshot(editor)
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

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, 'plain text without replacement token', text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodesByType(editor, HITLInputNode)).toHaveLength(0)
      })
    })

    it('should replace token with empty env conversation and rag lists when variables are not provided', async () => {
      const { getEditor } = renderReplacementPlugin()

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, '{{#$output.user_name#}}', text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodesByType(editor, HITLInputNode)).toHaveLength(1)
      })

      const node = readFirstHITLInputNodeSnapshot(editor)
      expect(node).not.toBeNull()
      if (!node)
        throw new Error('Expected HITLInputNode snapshot')

      expect(node.environmentVariables).toEqual([])
      expect(node.conversationVariables).toEqual([])
      expect(node.ragVariables).toEqual([])
      expect(node.readonly).toBe(false)
    })

    it('should replace token with empty form inputs when formInputs is undefined', async () => {
      const { getEditor } = renderReplacementPlugin({ formInputs: null })

      const editor = await waitForEditorReady(getEditor)

      setEditorRootText(editor, '{{#$output.user_name#}}', text => new CustomTextNode(text))

      await waitFor(() => {
        expect(getNodesByType(editor, HITLInputNode)).toHaveLength(1)
      })

      const node = readFirstHITLInputNodeSnapshot(editor)
      expect(node).not.toBeNull()
      if (!node)
        throw new Error('Expected HITLInputNode snapshot')

      expect(node.formInputsLength).toBe(0)
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
