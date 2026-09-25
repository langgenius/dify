import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, screen, waitFor } from '@testing-library/react'
import { ReactFlowProvider } from 'reactflow'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { CaptureEditorPlugin } from '../../__tests__/test-utils'
import WorkflowVariableBlockComponent from '../component'
import { UPDATE_WORKFLOW_NODES_MAP } from '../index'
import { WorkflowVariableBlockNode } from '../node'

const SOURCE_NODE_ID = 'tool-1'
const VARIABLE_NAMES = ['output_alpha', 'output_beta', 'output_gamma']

/**
 * `VariableLabel` renders this icon whenever it is given an `errorMsg`, and the
 * message itself only appears inside a hover tooltip. The sibling HITL variable
 * block spec asserts on the same marker.
 */
const errorMarkers = (blockIndex: number) =>
  screen.getByTestId(`block-${blockIndex}`).querySelectorAll('.text-text-warning')

const createWorkflowNodesMap = () => ({
  [SOURCE_NODE_ID]: {
    title: 'My Tool',
    type: BlockEnum.Tool,
    height: 100,
    width: 120,
    position: { x: 0, y: 0 },
  },
})

const renderVariableBlocks = () => {
  let editor: LexicalEditor | null = null
  const setEditor = (value: LexicalEditor) => {
    editor = value
  }

  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(), {
    data: [],
    plugins: {},
  })

  const utils = renderWithConsoleQuery(
    <ReactFlowProvider>
      <LexicalComposer
        initialConfig={{
          namespace: 'workflow-variable-block-multi-block-dispatch-test',
          onError: (error: Error) => {
            throw error
          },
          nodes: [WorkflowVariableBlockNode],
        }}
      >
        {VARIABLE_NAMES.map((variable, index) => (
          <div key={variable} data-testid={`block-${index}`}>
            <WorkflowVariableBlockComponent
              nodeKey={`block-${index}`}
              variables={[SOURCE_NODE_ID, variable]}
              workflowNodesMap={{}}
            />
          </div>
        ))}
        <CaptureEditorPlugin onReady={setEditor} />
      </LexicalComposer>
    </ReactFlowProvider>,
    { queryClient },
  )

  return { ...utils, getEditor: () => editor }
}

describe('UPDATE_WORKFLOW_NODES_MAP broadcast', () => {
  it('updates every mounted variable block, not only the first', async () => {
    const { getEditor } = renderVariableBlocks()

    // No block has received variable metadata yet, so all three report the
    // invalid-variable warning.
    VARIABLE_NAMES.forEach((_, index) => {
      expect(errorMarkers(index)).toHaveLength(1)
    })

    await waitFor(() => {
      expect(getEditor()).not.toBeNull()
    })
    const editor = getEditor()!

    act(() => {
      editor.update(() => {
        editor.dispatchCommand(UPDATE_WORKFLOW_NODES_MAP, {
          workflowNodesMap: createWorkflowNodesMap(),
          availableVariables: [
            {
              nodeId: SOURCE_NODE_ID,
              title: 'My Tool',
              vars: VARIABLE_NAMES.map((variable) => ({ variable, type: VarType.string })),
            },
          ],
        })
      })
    })

    // A single broadcast must reach every block. If the first listener stops
    // propagation, the later blocks keep their empty metadata and stay invalid.
    await waitFor(() => {
      VARIABLE_NAMES.forEach((_, index) => {
        expect(errorMarkers(index)).toHaveLength(0)
      })
    })
  })
})
