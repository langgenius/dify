import { render } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

vi.mock('reactflow', () => ({
  Handle: (props: { id: string, type: string, className?: string }) => (
    <div data-testid="handle" data-handleid={props.id} data-type={props.type} className={props.className} />
  ),
  Position: {
    Right: 'right',
  },
}))

describe('workflow preview question classifier node', () => {
  it('renders one output handle per configured class', () => {
    const props: React.ComponentProps<typeof Node> = {
      id: 'classifier-1',
      type: 'question-classifier-node',
      selected: false,
      zIndex: 1,
      isConnectable: true,
      dragging: false,
      xPos: 0,
      yPos: 0,
      dragHandle: undefined,
      data: {
        type: BlockEnum.QuestionClassifier,
        title: 'Classifier',
        desc: '',
        classes: [
          { id: 'class-1', name: 'Billing', label: 'Billing label' },
          { id: 'class-2', name: 'Support' },
        ],
      } as never,
    }

    const { container, getByText } = render(
      <Node {...props} />,
    )

    expect(getByText('Billing label')).toBeInTheDocument()
    expect(getByText('CLASS 2')).toBeInTheDocument()
    expect(container.querySelector('[data-handleid="class-1"]')).toBeInTheDocument()
    expect(container.querySelector('[data-handleid="class-2"]')).toBeInTheDocument()
  })
})
