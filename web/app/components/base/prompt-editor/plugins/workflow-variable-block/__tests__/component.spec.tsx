import type { LexicalEditor } from 'lexical'
import type { ComponentProps } from 'react'
import type WorkflowVariableBlockComponent from '../component'
import type { WorkflowNodesMap } from '../node'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { $createParagraphNode, $getRoot } from 'lexical'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { UPDATE_WORKFLOW_NODES_MAP } from '../index'
import { $createWorkflowVariableBlockNode, WorkflowVariableBlockNode } from '../node'

// The editor owns the jump coordinates; ReactFlow owns applying them to its canvas.
const setViewport = vi.hoisted(() => vi.fn())
vi.mock('reactflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('reactflow')>()
  return { ...actual, useReactFlow: () => ({ ...actual.useReactFlow(), setViewport }) }
})

type Props = Omit<ComponentProps<typeof WorkflowVariableBlockComponent>, 'nodeKey'>
const nodeMap: WorkflowNodesMap = {
  'node-1': {
    title: 'Node A',
    type: BlockEnum.LLM,
    width: 200,
    height: 100,
    position: { x: 50, y: 80 },
  },
}
const availableVariables = [
  { nodeId: 'node-1', title: 'Node A', vars: [{ variable: 'output', type: VarType.string }] },
]

function renderVariables(props: Props[], hasContainer = true) {
  let editor: LexicalEditor
  function Capture() {
    ;[editor] = useLexicalComposerContext()
    return null
  }
  const { queryClient } = createConsoleQueryWrapper()
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.queryKey(), {
    data: [],
    plugins: {},
  })
  const view = renderWorkflowFlowComponent(
    <div id={hasContainer ? 'workflow-container' : undefined}>
      <LexicalComposer
        initialConfig={{
          namespace: 'workflow-variable-test',
          nodes: [WorkflowVariableBlockNode],
          onError: (error: Error) => {
            throw error
          },
          editorState: () => {
            $getRoot().append(
              $createParagraphNode().append(
                ...props.map((props) =>
                  $createWorkflowVariableBlockNode(
                    props.variables,
                    props.workflowNodesMap,
                    props.getVarType,
                    props.availableVariables,
                  ),
                ),
              ),
            )
          },
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable aria-label="Prompt" />}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <Capture />
      </LexicalComposer>
    </div>,
    { queryClient, reactFlowProps: { fitView: false, defaultViewport: { x: 0, y: 0, zoom: 2 } } },
  )
  const container = document.getElementById('workflow-container')
  if (container) {
    Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true })
  }
  return { ...view, editor: editor! }
}

describe('WorkflowVariableBlockComponent', () => {
  it('requests a canvas jump to the referenced node while preserving zoom', async () => {
    const user = userEvent.setup()
    renderVariables([
      { variables: ['node-1', 'output'], workflowNodesMap: nodeMap, availableVariables },
    ])
    await user.click(await screen.findByText('output'))
    await waitFor(() =>
      expect(setViewport).toHaveBeenCalledExactlyOnceWith({ x: 0, y: 140, zoom: 2 }),
    )
  })

  it('updates every rendered variable after a workflow node-map broadcast', async () => {
    const user = userEvent.setup()
    const { editor } = renderVariables([
      { variables: ['node-1', 'output'], workflowNodesMap: nodeMap, availableVariables },
      {
        variables: ['node-2', 'result'],
        workflowNodesMap: { 'node-2': { ...nodeMap['node-1']!, title: 'Node B' } },
        availableVariables: [],
      },
    ])
    expect(await screen.findByText('Node A')).toBeInTheDocument()
    expect(screen.getByText('Node B')).toBeInTheDocument()
    act(() => {
      editor.dispatchCommand(UPDATE_WORKFLOW_NODES_MAP, {
        workflowNodesMap: {
          'node-1': { ...nodeMap['node-1']!, title: 'Renamed A' },
          'node-2': { ...nodeMap['node-1']!, title: 'Renamed B' },
        },
        availableVariables: [
          {
            nodeId: 'node-2',
            title: 'Renamed B',
            vars: [{ variable: 'result', type: VarType.string }],
          },
        ],
      })
    })
    expect(await screen.findByText('Renamed A')).toBeInTheDocument()
    expect(screen.getByText('Renamed B')).toBeInTheDocument()
    expect(screen.queryByText('Node A')).not.toBeInTheDocument()
    expect(screen.queryByText('Node B')).not.toBeInTheDocument()
    await user.hover(screen.getByText('output').closest('[data-base-ui-tooltip-trigger]')!)
    expect(await screen.findByText('workflow.errorMsg.invalidVariable')).toBeInTheDocument()
  })

  it('shows an invalid variable warning when the referenced output is unavailable', async () => {
    const user = userEvent.setup()
    renderVariables([
      { variables: ['node-1', 'missing'], workflowNodesMap: nodeMap, availableVariables },
    ])
    await user.hover(
      (await screen.findByText('missing')).closest('[data-base-ui-tooltip-trigger]')!,
    )
    expect(await screen.findByText('workflow.errorMsg.invalidVariable')).toBeInTheDocument()
  })

  it('shows the nested path and computed type in the real preview', async () => {
    const user = userEvent.setup()
    const getVarType = vi.fn(() => Type.number)
    renderVariables([
      {
        variables: ['node-1', 'output', 'field'],
        workflowNodesMap: nodeMap,
        availableVariables,
        getVarType,
      },
    ])
    await user.hover(await screen.findByText('field'))
    await waitFor(() =>
      expect(getVarType).toHaveBeenCalledWith({
        nodeId: 'node-1',
        valueSelector: ['node-1', 'output', 'field'],
      }),
    )
    expect(await screen.findByText('output')).toBeInTheDocument()
    expect(screen.getByText('number')).toBeInTheDocument()
  })

  it.each(['env', 'conversation', 'sys', 'rag'])(
    'renders a %s variable without a source node and does not jump to the canvas',
    async (namespace) => {
      const user = userEvent.setup()
      const variables = namespace === 'rag' ? ['rag', 'shared', 'answer'] : [namespace, 'answer']
      renderVariables([{ variables, workflowNodesMap: {} }])
      const label = await screen.findByText(namespace === 'sys' ? 'sys.answer' : 'answer')
      await user.click(label)
      expect(setViewport).not.toHaveBeenCalled()
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    },
  )

  it('does not jump when the canvas container is absent', async () => {
    const user = userEvent.setup()
    renderVariables(
      [{ variables: ['node-1', 'output'], workflowNodesMap: nodeMap, availableVariables }],
      false,
    )
    await user.click(await screen.findByText('output'))
    expect(setViewport).not.toHaveBeenCalled()
  })

  it('keeps the viewport finite when a source node has not been measured', async () => {
    const user = userEvent.setup()
    renderVariables([
      {
        variables: ['node-1', 'output'],
        workflowNodesMap: {
          'node-1': { ...nodeMap['node-1']!, width: undefined, height: undefined },
        },
        availableVariables,
      },
    ])
    await user.click(await screen.findByText('output'))
    await waitFor(() =>
      expect(setViewport).toHaveBeenCalledExactlyOnceWith({ x: 200, y: 240, zoom: 2 }),
    )
  })
})
