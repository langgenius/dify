import type { NodeProps } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import BaseCard from '../base'

vi.mock('reactflow', () => ({
  Handle: (props: { id: string, type: string, className?: string }) => (
    <div data-testid="handle" data-handleid={props.id} data-type={props.type} className={props.className} />
  ),
  Position: {
    Left: 'left',
    Right: 'right',
  },
}))

const ChildNode = ({ id, data }: Partial<NodeProps>) => (
  <div data-testid="base-node-child">{`${id}:${data?.title}`}</div>
)

describe('workflow preview base node card', () => {
  it('renders the title, description, child content, and connection handles', () => {
    render(
      <BaseCard
        id="node-1"
        data={{
          type: BlockEnum.Answer,
          title: 'Answer node',
          desc: 'This is a preview node',
        } as never}
      >
        <ChildNode />
      </BaseCard>,
    )

    expect(screen.getByText('Answer node')).toBeInTheDocument()
    expect(screen.getByText('This is a preview node')).toBeInTheDocument()
    expect(screen.getByTestId('base-node-child')).toHaveTextContent('node-1:Answer node')
    expect(document.querySelector('[data-handleid="target"]')).toBeInTheDocument()
    expect(document.querySelector('[data-handleid="source"]')).toBeInTheDocument()
  })

  it('uses the iteration layout and parallel badge for iteration nodes', () => {
    render(
      <BaseCard
        id="iteration-1"
        data={{
          type: BlockEnum.Iteration,
          title: 'Iteration node',
          desc: 'Ignored description',
          width: 360,
          height: 220,
          is_parallel: true,
        } as never}
      >
        <ChildNode />
      </BaseCard>,
    )

    expect(screen.getByTestId('base-node-child')).toHaveTextContent('iteration-1:Iteration node')
    expect(screen.getByText('workflow.nodes.iteration.parallelModeUpper')).toBeInTheDocument()
    expect(screen.queryByText('Ignored description')).not.toBeInTheDocument()
  })
})
