import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import EmbeddingModel from '../embedding-model'

const mockUseModelList = vi.hoisted(() => vi.fn())
const mockModelSelector = vi.hoisted(() => vi.fn(() => <div data-testid="model-selector">selector</div>))

vi.mock('@/app/components/workflow/nodes/_base/components/layout', () => ({
  Field: ({ children, fieldTitleProps }: { children: ReactNode, fieldTitleProps: { warningDot?: boolean } }) => (
    <div data-testid="field" data-warning-dot={String(!!fieldTitleProps.warningDot)}>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: mockUseModelList,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: mockModelSelector,
}))

describe('EmbeddingModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseModelList.mockReturnValue({ data: [{ provider: 'openai', model: 'text-embedding-3-large' }] })
  })

  it('should pass the selected model configuration and warning state to the selector field', () => {
    const onEmbeddingModelChange = vi.fn()

    render(
      <EmbeddingModel
        embeddingModel="text-embedding-3-large"
        embeddingModelProvider="openai"
        warningDot
        onEmbeddingModelChange={onEmbeddingModelChange}
      />,
    )

    expect(mockUseModelList).toHaveBeenCalledWith(ModelTypeEnum.textEmbedding)
    expect(mockModelSelector).toHaveBeenCalledWith(expect.objectContaining({
      defaultModel: {
        provider: 'openai',
        model: 'text-embedding-3-large',
      },
      modelList: [{ provider: 'openai', model: 'text-embedding-3-large' }],
      readonly: false,
      showDeprecatedWarnIcon: true,
    }), undefined)
  })

  it('should pass an undefined default model when the embedding model is incomplete', () => {
    render(<EmbeddingModel embeddingModel="text-embedding-3-large" />)

    expect(mockModelSelector).toHaveBeenCalledWith(expect.objectContaining({
      defaultModel: undefined,
    }), undefined)
  })
})
