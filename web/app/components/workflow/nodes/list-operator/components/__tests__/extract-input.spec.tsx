import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEdges, useNodes } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import ExtractInput from '../extract-input'

it('offers numeric upstream outputs and inserts the selected extraction index', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  function ExtractPanel() {
    const nodes = useNodes()
    const edges = useEdges()
    return nodes.length === 2 && edges.length === 1 ? (
      <ExtractInput nodeId="extract" value="" readOnly={false} onChange={onChange} />
    ) : null
  }
  renderWorkflowEditor(<ExtractPanel />, {
    nodes: [
      createNode({
        id: 'source',
        data: {
          title: 'Source',
          type: BlockEnum.Code,
          outputs: {
            count: { type: VarType.number },
            name: { type: VarType.string },
          },
        },
      }),
      createNode({ id: 'extract', data: { type: BlockEnum.ListFilter } }),
    ],
    edges: [createEdge({ source: 'source', target: 'extract' })],
  })
  await user.click(await screen.findByRole('textbox'))
  await user.paste('/')
  expect(await screen.findByText('count')).toBeInTheDocument()
  expect(screen.queryByText('name')).not.toBeInTheDocument()
  await user.click(screen.getByText('count'))
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('{{#source.count#}}'))
})
