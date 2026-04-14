import type { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { ModelBar } from '../model-bar'

type ModelProviderItem = {
  provider: string
  models: Array<{ model: string }>
}

const mockModelLists = new Map<ModelTypeEnum, ModelProviderItem[]>()

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: (modelType: ModelTypeEnum) => ({
    data: mockModelLists.get(modelType) || [],
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({
    defaultModel,
    modelList,
  }: {
    defaultModel?: { provider: string, model: string }
    modelList: ModelProviderItem[]
  }) => (
    <div>
      {defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : 'no-model'}
      :
      {modelList.length}
    </div>
  ),
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <div>{`indicator:${color}`}</div>,
}))

describe('agent/model-bar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockModelLists.clear()
    mockModelLists.set('llm' as ModelTypeEnum, [{ provider: 'openai', models: [{ model: 'gpt-4o' }] }])
    mockModelLists.set('moderation' as ModelTypeEnum, [])
    mockModelLists.set('rerank' as ModelTypeEnum, [])
    mockModelLists.set('speech2text' as ModelTypeEnum, [])
    mockModelLists.set('text-embedding' as ModelTypeEnum, [])
    mockModelLists.set('tts' as ModelTypeEnum, [])
  })

  it('should render an empty readonly selector with a warning when no model is selected', () => {
    render(<ModelBar />)

    const emptySelector = screen.getByText((_, element) => element?.textContent === 'no-model:0')

    fireEvent.mouseEnter(emptySelector)

    expect(emptySelector).toBeInTheDocument()
    expect(screen.getByText('indicator:red')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.modelNotSelected')).toBeInTheDocument()
  })

  it('should render the selected model without warning when it is installed', () => {
    render(<ModelBar provider="openai" model="gpt-4o" />)

    expect(screen.getByText('openai/gpt-4o:1')).toBeInTheDocument()
    expect(screen.queryByText('indicator:red')).not.toBeInTheDocument()
  })

  it('should show a warning tooltip when the selected model is not installed', () => {
    render(<ModelBar provider="openai" model="gpt-4.1" />)

    fireEvent.mouseEnter(screen.getByText('openai/gpt-4.1:1'))

    expect(screen.getByText('openai/gpt-4.1:1')).toBeInTheDocument()
    expect(screen.getByText('indicator:red')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.agent.modelNotInstallTooltip')).toBeInTheDocument()
  })
})
