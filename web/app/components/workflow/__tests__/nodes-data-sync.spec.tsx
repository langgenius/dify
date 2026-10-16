import type { Node } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useReactFlowStore, useStoreApi } from 'reactflow'
import { findWorkflowNodes } from '../goto-anything-search'
import { useWorkflowSearch } from '../hooks/use-workflow-search'
import AssignerNode from '../nodes/assigner/node'
import DocumentExtractorNode from '../nodes/document-extractor/node'
import ListOperatorNode from '../nodes/list-operator/node'
import { BlockEnum, VarType } from '../types'
import { createNode, createStartNode } from './fixtures'
import { renderWorkflowFlowComponent } from './workflow-test-env'

const services = vi.hoisted(() => ({ tools: { data: [] }, selectNode: vi.fn() }))

vi.mock('../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({ handleNodeSelect: services.selectNode }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => services.tools,
  useAllCustomTools: () => services.tools,
  useAllWorkflowTools: () => services.tools,
  useAllMCPTools: () => services.tools,
}))

vi.mock('../nodes/_base/components/variable/variable-label', () => ({
  VariableLabelInNode: ({ nodeTitle, variables }: { nodeTitle?: string; variables: string[] }) => (
    <span>{`${nodeTitle ?? 'Missing source'}:${variables.join('.')}`}</span>
  ),
}))

const sourceNode = createStartNode({ id: 'source', data: { title: 'Input files' } })

function GraphControls() {
  const store = useStoreApi()
  const position = useReactFlowStore((state) => state.nodeInternals.get('source')?.position)
  const updateNodes = (update: (nodes: Node[]) => Node[]) => {
    const { getNodes, setNodes } = store.getState()
    setNodes(update(getNodes() as Node[]))
  }

  return (
    <>
      <output aria-label="Source position">
        {position ? `${position.x},${position.y}` : 'removed'}
      </output>
      <button
        type="button"
        onClick={() =>
          updateNodes((nodes) =>
            nodes.map((node) =>
              node.id === 'source' ? { ...node, position: { x: 240, y: 360 } } : node,
            ),
          )
        }
      >
        Move source
      </button>
      <button
        type="button"
        onClick={() =>
          updateNodes((nodes) =>
            nodes.map((node) =>
              node.id === 'source'
                ? { ...node, data: { ...node.data, title: 'Renamed input' } }
                : node,
            ),
          )
        }
      >
        Rename source
      </button>
      <button
        type="button"
        onClick={() => updateNodes((nodes) => nodes.filter((node) => node.id !== 'source'))}
      >
        Remove source
      </button>
      <button
        type="button"
        onClick={() =>
          updateNodes((nodes) => [
            ...nodes,
            { ...sourceNode, data: { ...sourceNode.data, title: 'Restored input' } },
          ])
        }
      >
        Restore source
      </button>
    </>
  )
}

function SearchRegistration() {
  useWorkflowSearch()
  return null
}

function NodePreviews() {
  return (
    <>
      <DocumentExtractorNode
        id="extractor"
        data={{
          type: BlockEnum.DocExtractor,
          title: 'Extract',
          desc: '',
          variable_selector: ['source', 'files'],
          is_array_file: false,
        }}
      />
      <ListOperatorNode
        id="list"
        data={{
          type: BlockEnum.ListFilter,
          title: 'List',
          desc: '',
          variable: ['source', 'items'],
          var_type: VarType.arrayString,
          item_var_type: VarType.string,
          filter_by: { enabled: false, conditions: [] },
          extract_by: { enabled: false },
          order_by: { enabled: false, key: [], value: 'asc' },
          limit: { enabled: false },
        }}
      />
      <AssignerNode
        id="assigner"
        data={{
          type: BlockEnum.Assigner,
          title: 'Assign',
          desc: '',
          version: '2',
          items: [
            {
              variable_selector: ['source', 'count'],
              input_type: 'variable',
              operation: 'over-write',
              value: '',
            },
          ],
        }}
      />
    </>
  )
}

describe('workflow node data synchronization', () => {
  it('keeps positions live and updates node labels and search after content changes, deletion and restore', async () => {
    const user = userEvent.setup()
    renderWorkflowFlowComponent(
      <>
        <GraphControls />
        <SearchRegistration />
        <NodePreviews />
      </>,
      { nodes: [sourceNode, createNode({ id: 'unrelated' })] },
    )

    expect(screen.getByText('Input files:source.files')).toBeInTheDocument()
    expect(screen.getByText('Input files:source.items')).toBeInTheDocument()
    expect(screen.getByText('Input files:source.count')).toBeInTheDocument()
    expect(findWorkflowNodes('Input files')[0]?.id).toBe('source')

    await user.click(screen.getByRole('button', { name: 'Move source' }))
    expect(screen.getByLabelText('Source position')).toHaveTextContent('240,360')
    expect(screen.getByText('Input files:source.files')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Rename source' }))
    expect(screen.getByText('Renamed input:source.files')).toBeInTheDocument()
    expect(screen.getByText('Renamed input:source.items')).toBeInTheDocument()
    expect(screen.getByText('Renamed input:source.count')).toBeInTheDocument()
    expect(findWorkflowNodes('Input files')).toEqual([])
    expect(findWorkflowNodes('Renamed input')[0]?.id).toBe('source')

    await user.click(screen.getByRole('button', { name: 'Remove source' }))
    expect(screen.getByText('Missing source:source.files')).toBeInTheDocument()
    expect(findWorkflowNodes('Renamed input')).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Restore source' }))
    expect(screen.getByText('Restored input:source.files')).toBeInTheDocument()
    expect(screen.getByText('Restored input:source.items')).toBeInTheDocument()
    expect(screen.getByText('Restored input:source.count')).toBeInTheDocument()
    expect(findWorkflowNodes('Restored input')[0]?.id).toBe('source')
  })

  it('continues resolving system variables through the start node', async () => {
    const user = userEvent.setup()
    renderWorkflowFlowComponent(
      <>
        <GraphControls />
        <DocumentExtractorNode
          id="extractor"
          data={{
            type: BlockEnum.DocExtractor,
            title: 'Extract',
            desc: '',
            variable_selector: ['sys', 'files'],
            is_array_file: false,
          }}
        />
      </>,
      { nodes: [sourceNode] },
    )

    expect(screen.getByText('Input files:sys.files')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rename source' }))
    expect(screen.getByText('Renamed input:sys.files')).toBeInTheDocument()
  })
})
