import type { QuestionClassifierNodeType, Topic } from '../types'
import { render, screen } from '@testing-library/react'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

vi.mock('@/app/components/base/tooltip', () => ({
  __esModule: true,
  default: ({
    children,
    popupContent,
  }: {
    children: React.ReactNode
    popupContent: React.ReactNode
  }) => (
    <div>
      {children}
      {popupContent}
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  __esModule: true,
  default: ({ defaultModel }: { defaultModel?: { provider: string, model: string } }) => (
    <div>{defaultModel ? `${defaultModel.provider}:${defaultModel.model}` : 'no-model'}</div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/node-handle', () => ({
  __esModule: true,
  NodeSourceHandle: ({ handleId }: { handleId: string }) => <div>{`handle-${handleId}`}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/readonly-input-with-select-var', () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div>{value}</div>,
}))

const mockUseTextGeneration = vi.mocked(useTextGenerationCurrentProviderAndModelAndModelList)

const createTopic = (overrides: Partial<Topic> = {}): Topic => ({
  id: 'topic-1',
  name: 'Billing questions',
  ...overrides,
})

const createData = (overrides: Partial<QuestionClassifierNodeType> = {}): QuestionClassifierNodeType => ({
  title: 'Question Classifier',
  desc: '',
  type: BlockEnum.QuestionClassifier,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat',
    completion_params: {},
  } as QuestionClassifierNodeType['model'],
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
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTextGeneration.mockReturnValue({
      textGenerationModelList: [{ provider: 'openai', model: 'gpt-4o' }],
    } as unknown as ReturnType<typeof useTextGenerationCurrentProviderAndModelAndModelList>)
  })

  it('renders the selected model and output handles for each class', () => {
    render(
      <Node
        {...baseNodeProps}
        data={createData({ classes: [createTopic(), createTopic({ id: 'topic-2', name: 'Refunds' })] })}
      />,
    )

    expect(screen.getByText('openai:gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('Billing questions')).toBeInTheDocument()
    expect(screen.getByText('handle-topic-1')).toBeInTheDocument()
    expect(screen.getByText('handle-topic-2')).toBeInTheDocument()
  })

  it('returns nothing when neither model nor classes are configured and truncates long class names', () => {
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
          } as QuestionClassifierNodeType['model'],
          classes: [createTopic({ id: 'topic-2', name: longName })],
        })}
      />,
    )

    expect(screen.getByText(`${longName.slice(0, 50)}...`)).toBeInTheDocument()
    expect(screen.getByText(longName)).toBeInTheDocument()

    rerender(
      <Node
        {...baseNodeProps}
        data={createData({
          model: {
            provider: '',
            name: '',
            mode: 'chat',
            completion_params: {},
          } as QuestionClassifierNodeType['model'],
          classes: [],
        })}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
