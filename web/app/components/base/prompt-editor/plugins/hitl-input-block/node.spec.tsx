import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { Var } from '@/app/components/workflow/types'
import { act } from '@testing-library/react'
import {
  BlockEnum,
  InputVarType,
} from '@/app/components/workflow/types'
import {
  createLexicalTestEditor,
  expectInlineWrapperDom,
} from '../test-helpers'
import HITLInputBlockComponent from './component'
import {
  $createHITLInputNode,
  $isHITLInputNode,
  HITLInputNode,
} from './node'

const createFormInput = (): FormInputItem => ({
  type: InputVarType.paragraph,
  output_variable_name: 'user_name',
  default: {
    type: 'constant',
    selector: [],
    value: 'hello',
  },
})

const createNodeProps = () => {
  return {
    variableName: 'user_name',
    nodeId: 'node-1',
    formInputs: [createFormInput()],
    onFormInputsChange: vi.fn(),
    onFormInputItemRename: vi.fn(),
    onFormInputItemRemove: vi.fn(),
    workflowNodesMap: {
      'node-1': {
        title: 'Node 1',
        type: BlockEnum.Start,
        height: 100,
        width: 100,
        position: { x: 0, y: 0 },
      },
    },
    getVarType: vi.fn(),
    environmentVariables: [{ variable: 'env.var_a', type: 'string' }] as Var[],
    conversationVariables: [{ variable: 'conversation.var_b', type: 'number' }] as Var[],
    ragVariables: [{ variable: 'rag.shared.var_c', type: 'string', isRagVariable: true }] as Var[],
    readonly: true,
  }
}

const createTestEditor = () => {
  return createLexicalTestEditor('hitl-input-node-test', [HITLInputNode])
}

describe('HITLInputNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should expose node metadata and configured properties through getters', () => {
    const editor = createTestEditor()
    const props = createNodeProps()

    expect(HITLInputNode.getType()).toBe('hitl-input-block')

    act(() => {
      editor.update(() => {
        const node = $createHITLInputNode(
          props.variableName,
          props.nodeId,
          props.formInputs,
          props.onFormInputsChange,
          props.onFormInputItemRename,
          props.onFormInputItemRemove,
          props.workflowNodesMap,
          props.getVarType,
          props.environmentVariables,
          props.conversationVariables,
          props.ragVariables,
          props.readonly,
        )

        expect(node.isInline()).toBe(true)
        expect(node.isIsolated()).toBe(true)
        expect(node.isTopLevel()).toBe(true)
        expect(node.getVariableName()).toBe(props.variableName)
        expect(node.getNodeId()).toBe(props.nodeId)
        expect(node.getFormInputs()).toEqual(props.formInputs)
        expect(node.getOnFormInputsChange()).toBe(props.onFormInputsChange)
        expect(node.getOnFormInputItemRename()).toBe(props.onFormInputItemRename)
        expect(node.getOnFormInputItemRemove()).toBe(props.onFormInputItemRemove)
        expect(node.getWorkflowNodesMap()).toEqual(props.workflowNodesMap)
        expect(node.getGetVarType()).toBe(props.getVarType)
        expect(node.getEnvironmentVariables()).toEqual(props.environmentVariables)
        expect(node.getConversationVariables()).toEqual(props.conversationVariables)
        expect(node.getRagVariables()).toEqual(props.ragVariables)
        expect(node.getReadonly()).toBe(true)
        expect(node.getTextContent()).toBe('{{#$output.user_name#}}')
      })
    })
  })

  it('should return default fallback values for optional properties', () => {
    const editor = createTestEditor()
    const props = createNodeProps()

    act(() => {
      editor.update(() => {
        const node = $createHITLInputNode(
          props.variableName,
          props.nodeId,
          props.formInputs,
          props.onFormInputsChange,
          props.onFormInputItemRename,
          props.onFormInputItemRemove,
          props.workflowNodesMap,
        )

        expect(node.getEnvironmentVariables()).toEqual([])
        expect(node.getConversationVariables()).toEqual([])
        expect(node.getRagVariables()).toEqual([])
        expect(node.getReadonly()).toBe(false)
      })
    })
  })

  it('should clone, serialize, import and decorate correctly', () => {
    const editor = createTestEditor()
    const props = createNodeProps()

    act(() => {
      editor.update(() => {
        const node = $createHITLInputNode(
          props.variableName,
          props.nodeId,
          props.formInputs,
          props.onFormInputsChange,
          props.onFormInputItemRename,
          props.onFormInputItemRemove,
          props.workflowNodesMap,
          props.getVarType,
          props.environmentVariables,
          props.conversationVariables,
          props.ragVariables,
          props.readonly,
        )

        const serialized = node.exportJSON()
        const cloned = HITLInputNode.clone(node)
        const imported = HITLInputNode.importJSON(serialized)

        expect(cloned).toBeInstanceOf(HITLInputNode)
        expect(cloned.getKey()).toBe(node.getKey())
        expect(cloned).not.toBe(node)
        expect(imported).toBeInstanceOf(HITLInputNode)

        const element = node.decorate()
        expect(element.type).toBe(HITLInputBlockComponent)
        expect(element.props.nodeKey).toBe(node.getKey())
        expect(element.props.varName).toBe('user_name')
      })
    })
  })

  it('should fallback to empty form inputs when imported payload omits formInputs', () => {
    const editor = createTestEditor()
    const props = createNodeProps()

    act(() => {
      editor.update(() => {
        const source = $createHITLInputNode(
          props.variableName,
          props.nodeId,
          props.formInputs,
          props.onFormInputsChange,
          props.onFormInputItemRename,
          props.onFormInputItemRemove,
          props.workflowNodesMap,
          props.getVarType,
          props.environmentVariables,
          props.conversationVariables,
          props.ragVariables,
          props.readonly,
        )

        const payload = {
          ...source.exportJSON(),
          formInputs: undefined as unknown as FormInputItem[],
        }

        const imported = HITLInputNode.importJSON(payload)
        const cloned = HITLInputNode.clone(imported)

        expect(imported.getFormInputs()).toEqual([])
        expect(cloned.getFormInputs()).toEqual([])
      })
    })
  })

  it('should create and update DOM and support helper type guard', () => {
    const editor = createTestEditor()
    const props = createNodeProps()

    act(() => {
      editor.update(() => {
        const node = $createHITLInputNode(
          props.variableName,
          props.nodeId,
          props.formInputs,
          props.onFormInputsChange,
          props.onFormInputItemRename,
          props.onFormInputItemRemove,
          props.workflowNodesMap,
          props.getVarType,
          props.environmentVariables,
          props.conversationVariables,
          props.ragVariables,
          props.readonly,
        )

        const dom = node.createDOM()

        expectInlineWrapperDom(dom, ['w-[calc(100%-1px)]', 'support-drag'])
        expect(node.updateDOM()).toBe(false)
        expect($isHITLInputNode(node)).toBe(true)
      })
    })

    expect($isHITLInputNode(null)).toBe(false)
    expect($isHITLInputNode(undefined)).toBe(false)
  })
})
