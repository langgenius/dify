import type { LLMNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import Node from '../node'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  __esModule: true,
  default: ({ defaultModel }: { defaultModel?: { provider: string, model: string } }) => (
    <div>{defaultModel ? `${defaultModel.provider}:${defaultModel.model}` : 'no-model'}</div>
  ),
}))

const mockUseTextGeneration = vi.mocked(useTextGenerationCurrentProviderAndModelAndModelList)

const createData = (overrides: Partial<LLMNodeType> = {}): LLMNodeType => ({
  title: 'LLM',
  desc: '',
  type: BlockEnum.LLM,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  } as LLMNodeType['model'],
  prompt_template: [],
  context: {
    enabled: false,
    variable_selector: [],
  },
  vision: {
    enabled: false,
  },
  ...overrides,
})

describe('llm/node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTextGeneration.mockReturnValue({
      textGenerationModelList: [{ provider: 'openai', model: 'gpt-4o' }],
    } as unknown as ReturnType<typeof useTextGenerationCurrentProviderAndModelAndModelList>)
  })

  it('renders the readonly model selector when a model is configured', () => {
    render(
      <Node
        id="llm-node"
        data={createData()}
      />,
    )

    expect(screen.getByText('openai:gpt-4o')).toBeInTheDocument()
  })

  it('renders nothing when the node has no configured model', () => {
    render(
      <Node
        id="llm-node"
        data={createData({
          model: {
            provider: '',
            name: '',
            mode: AppModeEnum.CHAT,
            completion_params: {},
          } as LLMNodeType['model'],
        })}
      />,
    )

    expect(screen.queryByText('openai:gpt-4o')).not.toBeInTheDocument()
  })
})
