import type { QuestionClassifierNodeType } from '../types'
import type { Topic } from '@/app/components/workflow/nodes/_base/components/branch-list/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({ textGenerationModelList: [] }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: ({ value }: { value?: { provider: string; model: string } }) => (
    <div>{value ? `${value.provider}:${value.model}` : 'no-model'}</div>
  ),
}))

const mockSourceHandle = vi.fn()
vi.mock('@/app/components/workflow/nodes/_base/components/node-handle', () => ({
  NodeSourceHandle: (props: { id: string; handleId: string }) => {
    mockSourceHandle(props)
    return null
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/readonly-input-with-select-var', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div>{value}</div>,
}))

const createTopic = (overrides: Partial<Topic> = {}): Topic => ({
  id: 'topic-1',
  name: 'Billing questions',
  ...overrides,
})

const createData = (
  overrides: Partial<QuestionClassifierNodeType> = {},
): QuestionClassifierNodeType => ({
  title: 'Question Classifier',
  desc: '',
  type: BlockEnum.QuestionClassifier,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat',
    completion_params: {},
  },
  classes: [createTopic()],
  query_variable_selector: ['node-1', 'query'],
  instruction: 'Route by topic',
  vision: {
    enabled: false,
  },
  ...overrides,
})

const baseNodeProps = {
  id: 'node-1',
  type: 'custom',
  selected: false,
  zIndex: 1,
  xPos: 0,
  yPos: 0,
  dragging: false,
  isConnectable: true,
}

describe('question-classifier/node', () => {
  it('shows class labels and routes each class ID to its connection handle', () => {
    render(
      <Node
        {...baseNodeProps}
        data={createData({
          classes: [
            createTopic({ label: 'Billing' }),
            createTopic({ id: 'topic-2', name: 'Refunds', label: 'Refund desk' }),
          ],
        })}
      />,
    )

    expect(screen.getByText('openai:gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('Billing')).toBeInTheDocument()
    expect(screen.getByText('Refund desk')).toBeInTheDocument()
    expect(mockSourceHandle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'node-1', handleId: 'topic-1' }),
    )
    expect(mockSourceHandle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'node-1', handleId: 'topic-2' }),
    )
  })

  it('returns nothing when neither model nor classes are configured and truncates long class names', async () => {
    const user = userEvent.setup()
    const longName = 'L'.repeat(60)
    const { container, rerender } = render(
      <Node
        {...baseNodeProps}
        data={createData({
          model: {
            provider: '',
            name: '',
            mode: 'chat',
            completion_params: {},
          },
          classes: [createTopic({ id: 'topic-2', name: longName })],
        })}
      />,
    )

    expect(screen.getByText(`${longName.slice(0, 50)}...`)).toBeInTheDocument()
    await user.hover(screen.getByRole('button', { name: longName }))
    expect(await screen.findByText(longName)).toBeInTheDocument()

    rerender(
      <Node
        {...baseNodeProps}
        data={createData({
          model: {
            provider: '',
            name: '',
            mode: 'chat',
            completion_params: {},
          },
          classes: [],
        })}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
