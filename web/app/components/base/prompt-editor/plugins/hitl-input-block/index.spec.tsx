import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { act, render, waitFor } from '@testing-library/react'
import {
  COMMAND_PRIORITY_EDITOR,
} from 'lexical'
import { useEffect } from 'react'
import {
  BlockEnum,
  InputVarType,
} from '@/app/components/workflow/types'
import { CustomTextNode } from '../custom-text/node'
import {
  getNodeCount,
  readRootTextContent,
  renderLexicalEditor,
  selectRootEnd,
  waitForEditorReady,
} from '../test-helpers'
import {
  DELETE_HITL_INPUT_BLOCK_COMMAND,
  HITLInputBlock,
  HITLInputNode,
  INSERT_HITL_INPUT_BLOCK_COMMAND,
  UPDATE_WORKFLOW_NODES_MAP,
} from './index'

type UpdateWorkflowNodesMapPluginProps = {
  onUpdate: (payload: unknown) => void
}

const UpdateWorkflowNodesMapPlugin = ({ onUpdate }: UpdateWorkflowNodesMapPluginProps) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      UPDATE_WORKFLOW_NODES_MAP,
      (payload: unknown) => {
        onUpdate(payload)
        return true
      },
      COMMAND_PRIORITY_EDITOR,
    )
  }, [editor, onUpdate])

  return null
}

const createWorkflowNodesMap = (title: string) => ({
  'node-1': {
    title,
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

const createInsertPayload = () => ({
  variableName: 'user_name',
  nodeId: 'node-1',
  formInputs: [createFormInput()],
  onFormInputsChange: vi.fn(),
  onFormInputItemRename: vi.fn(),
  onFormInputItemRemove: vi.fn(),
})

const renderHITLInputBlock = (props?: {
  onInsert?: () => void
  onDelete?: () => void
  workflowNodesMap?: ReturnType<typeof createWorkflowNodesMap>
  onWorkflowMapUpdate?: (payload: unknown) => void
}) => {
  const workflowNodesMap = props?.workflowNodesMap ?? createWorkflowNodesMap('First Node')

  return renderLexicalEditor({
    namespace: 'hitl-input-block-plugin-test',
    nodes: [CustomTextNode, HITLInputNode],
    children: (
      <>
        {props?.onWorkflowMapUpdate && <UpdateWorkflowNodesMapPlugin onUpdate={props.onWorkflowMapUpdate} />}
        <HITLInputBlock
          nodeId="node-1"
          formInputs={[createFormInput()]}
          onFormInputItemRename={vi.fn()}
          onFormInputItemRemove={vi.fn()}
          workflowNodesMap={workflowNodesMap}
          onInsert={props?.onInsert}
          onDelete={props?.onDelete}
        />
      </>
    ),
  })
}

describe('HITLInputBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Workflow map command dispatch', () => {
    it('should dispatch UPDATE_WORKFLOW_NODES_MAP when mounted', async () => {
      const onWorkflowMapUpdate = vi.fn()
      const workflowNodesMap = createWorkflowNodesMap('Map Node')

      renderHITLInputBlock({
        workflowNodesMap,
        onWorkflowMapUpdate,
      })

      await waitFor(() => {
        expect(onWorkflowMapUpdate).toHaveBeenCalledWith(workflowNodesMap)
      })
    })
  })

  describe('Command handling', () => {
    it('should insert hitl input block and call onInsert when insert command is dispatched', async () => {
      const onInsert = vi.fn()
      const { getEditor } = renderHITLInputBlock({ onInsert })

      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(INSERT_HITL_INPUT_BLOCK_COMMAND, createInsertPayload())
      })

      expect(handled).toBe(true)
      expect(onInsert).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(readRootTextContent(editor)).toContain('{{#$output.user_name#}}')
      })
      expect(getNodeCount(editor, HITLInputNode)).toBe(1)
    })

    it('should insert hitl input block without onInsert callback', async () => {
      const { getEditor } = renderHITLInputBlock()

      const editor = await waitForEditorReady(getEditor)

      selectRootEnd(editor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(INSERT_HITL_INPUT_BLOCK_COMMAND, createInsertPayload())
      })

      expect(handled).toBe(true)
      await waitFor(() => {
        expect(readRootTextContent(editor)).toContain('{{#$output.user_name#}}')
      })
      expect(getNodeCount(editor, HITLInputNode)).toBe(1)
    })

    it('should call onDelete when delete command is dispatched', async () => {
      const onDelete = vi.fn()
      const { getEditor } = renderHITLInputBlock({ onDelete })

      const editor = await waitForEditorReady(getEditor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(DELETE_HITL_INPUT_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('should handle delete command without onDelete callback', async () => {
      const { getEditor } = renderHITLInputBlock()

      const editor = await waitForEditorReady(getEditor)

      let handled = false
      act(() => {
        handled = editor.dispatchCommand(DELETE_HITL_INPUT_BLOCK_COMMAND, undefined)
      })

      expect(handled).toBe(true)
    })
  })

  describe('Lifecycle', () => {
    it('should unregister insert and delete commands when unmounted', async () => {
      const { getEditor, unmount } = renderHITLInputBlock()

      const editor = await waitForEditorReady(getEditor)

      unmount()

      let insertHandled = true
      let deleteHandled = true
      act(() => {
        insertHandled = editor.dispatchCommand(INSERT_HITL_INPUT_BLOCK_COMMAND, createInsertPayload())
        deleteHandled = editor.dispatchCommand(DELETE_HITL_INPUT_BLOCK_COMMAND, undefined)
      })

      expect(insertHandled).toBe(false)
      expect(deleteHandled).toBe(false)
    })

    it('should throw when hitl input node is not registered on editor', () => {
      expect(() => {
        render(
          <LexicalComposer
            initialConfig={{
              namespace: 'hitl-input-block-plugin-missing-node-test',
              onError: (error: Error) => {
                throw error
              },
              nodes: [CustomTextNode],
            }}
          >
            <HITLInputBlock
              nodeId="node-1"
              formInputs={[createFormInput()]}
              onFormInputItemRename={vi.fn()}
              onFormInputItemRemove={vi.fn()}
              workflowNodesMap={createWorkflowNodesMap('Map Node')}
            />
          </LexicalComposer>,
        )
      }).toThrow('HITLInputBlockPlugin: HITLInputBlock not registered on editor')
    })
  })
})
