import type { KnowledgeRetrievalV2NodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

const createData = (
  overrides: Partial<KnowledgeRetrievalV2NodeType> = {},
): KnowledgeRetrievalV2NodeType => ({
  title: 'Knowledge Retrieval v2',
  desc: '',
  type: BlockEnum.KnowledgeRetrievalV2,
  query_variable_selector: ['start', 'sys.query'],
  control_space_ids: ['space-1'],
  top_n: 8,
  _control_spaces: [{ control_space_id: 'space-1', name: 'Support', icon: '📚' }],
  ...overrides,
})

describe('knowledge-retrieval-v2/node', () => {
  it('renders selected space names and the effective node override', () => {
    render(<Node id="node-1" data={createData({ mode: 'deep' })} />)

    expect(screen.getByText('Support')).toBeInTheDocument()
    expect(screen.getByText('deep · top 8')).toBeInTheDocument()
  })

  it('falls back to the control space id and renders nothing without selections', () => {
    const { rerender, container } = render(
      <Node id="node-1" data={createData({ _control_spaces: undefined })} />,
    )
    expect(screen.getByText('space-1')).toBeInTheDocument()

    rerender(<Node id="node-1" data={createData({ control_space_ids: [] })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
