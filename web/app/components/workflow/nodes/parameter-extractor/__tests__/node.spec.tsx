import type { ParameterExtractorNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import {
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import Node from '../node'
import { ReasoningModeType } from '../types'

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

const createData = (overrides: Partial<ParameterExtractorNodeType> = {}): ParameterExtractorNodeType => ({
  title: 'Parameter Extractor',
  desc: '',
  type: BlockEnum.ParameterExtractor,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: AppModeEnum.CHAT,
    completion_params: {},
  } as ParameterExtractorNodeType['model'],
  query: ['node-1', 'query'],
  reasoning_mode: ReasoningModeType.prompt,
  parameters: [],
  instruction: 'Extract city and budget',
  vision: {
    enabled: false,
  },
  ...overrides,
})

describe('parameter-extractor/node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTextGeneration.mockReturnValue({
      textGenerationModelList: [{ provider: 'openai', model: 'gpt-4o' }],
    } as unknown as ReturnType<typeof useTextGenerationCurrentProviderAndModelAndModelList>)
  })

  it('renders the readonly model selector when a model is configured', () => {
    render(
      <Node
        id="node-1"
        data={createData()}
      />,
    )

    expect(screen.getByText('openai:gpt-4o')).toBeInTheDocument()
  })

  it('renders no model badge when the node has no configured model', () => {
    render(
      <Node
        id="node-1"
        data={createData({
          model: {
            provider: '',
            name: '',
            mode: AppModeEnum.CHAT,
            completion_params: {},
          } as ParameterExtractorNodeType['model'],
        })}
      />,
    )

    expect(screen.queryByText('openai:gpt-4o')).not.toBeInTheDocument()
  })
})
