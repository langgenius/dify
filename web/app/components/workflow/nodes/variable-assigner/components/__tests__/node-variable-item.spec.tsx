import type { Node, ValueSelector } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import { WriteMode } from '@/app/components/workflow/nodes/assigner/types'
import { BlockEnum } from '@/app/components/workflow/types'
import NodeVariableItem from '../node-variable-item'

const createNode = (title: string): Node => ({
  id: 'node-1',
  position: { x: 0, y: 0 },
  data: {
    title,
    desc: '',
    type: BlockEnum.Code,
  },
} as unknown as Node)

describe('variable-assigner/node-variable-item', () => {
  it('renders the node title, derived variable name, and write mode badge for env vars', () => {
    render(
      <NodeVariableItem
        node={createNode('Code Node')}
        variable={['env', 'API_KEY'] satisfies ValueSelector}
        writeMode={WriteMode.append}
      />,
    )

    expect(screen.getByText('Code Node')).toBeInTheDocument()
    expect(screen.getByText('API_KEY')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.assigner.operations.append')).toBeInTheDocument()
  })

  it('formats system variables with the sys prefix and supports exception styling', () => {
    render(
      <NodeVariableItem
        node={createNode('Start Node')}
        variable={['sys', 'query'] satisfies ValueSelector}
        isException
      />,
    )

    expect(screen.getByText('sys.query')).toBeInTheDocument()
    expect(screen.getByText('Start Node')).toBeInTheDocument()
  })

  it('renders conversation variables without the sys prefix', () => {
    render(
      <NodeVariableItem
        node={createNode('Chat Node')}
        variable={['conversation', 'summary'] satisfies ValueSelector}
      />,
    )

    expect(screen.getByText('summary')).toBeInTheDocument()
    expect(screen.getByText('Chat Node')).toBeInTheDocument()
  })

  it('renders rag variables using the terminal segment as the visible variable name', () => {
    render(
      <NodeVariableItem
        node={createNode('RAG Node')}
        variable={['rag', 'shared', 'score'] satisfies ValueSelector}
      />,
    )

    expect(screen.getByText('score')).toBeInTheDocument()
    expect(screen.getByText('RAG Node')).toBeInTheDocument()
  })
})
