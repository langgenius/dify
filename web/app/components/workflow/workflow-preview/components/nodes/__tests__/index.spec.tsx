import { render } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import CustomNode from '../index'

vi.mock('reactflow', () => ({
  Handle: (props: { id: string, type: string, className?: string }) => (
    <div data-testid="handle" data-handleid={props.id} data-type={props.type} className={props.className} />
  ),
  Position: {
    Left: 'left',
    Right: 'right',
  },
}))

describe('workflow preview custom node', () => {
  it('renders the mapped node component inside the shared base card', () => {
    const props: React.ComponentProps<typeof CustomNode> = {
      id: 'classifier-1',
      type: 'custom-node',
      selected: false,
      zIndex: 1,
      isConnectable: true,
      dragging: false,
      xPos: 0,
      yPos: 0,
      dragHandle: undefined,
      data: {
        type: BlockEnum.QuestionClassifier,
        title: 'Classifier node',
        desc: '',
        classes: [
          { id: 'class-a', name: 'Billing' },
        ],
      } as never,
    }

    const { container, getByText } = render(
      <CustomNode {...props} />,
    )

    expect(getByText('Classifier node')).toBeInTheDocument()
    expect(container.querySelector('[data-handleid="class-a"]')).toBeInTheDocument()
  })
})
