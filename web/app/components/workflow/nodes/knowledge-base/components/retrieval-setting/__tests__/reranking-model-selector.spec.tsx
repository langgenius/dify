import type {
  DefaultModel,
  Model,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  createModel,
  createModelItem,
} from '@/app/components/workflow/__tests__/model-provider-fixtures'
import RerankingModelSelector from '../reranking-model-selector'

type MockModelSelectorProps = {
  defaultModel?: DefaultModel
  modelList: Model[]
  onSelect?: (model: DefaultModel) => void
}

const mockUseModelListAndDefaultModel = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModel: mockUseModelListAndDefaultModel,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({ defaultModel, modelList, onSelect }: MockModelSelectorProps) => (
    <div>
      <div data-testid="default-model">
        {defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : 'no-default-model'}
      </div>
      <div data-testid="model-list-count">{modelList.length}</div>
      <button type="button" onClick={() => onSelect?.({ provider: 'cohere', model: 'rerank-v3' })}>
        select-model
      </button>
    </div>
  ),
}))

describe('RerankingModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseModelListAndDefaultModel.mockReturnValue({
      modelList: [createModel({
        provider: 'cohere',
        label: { en_US: 'Cohere', zh_Hans: 'Cohere' },
        models: [createModelItem({
          model: 'rerank-v3',
          model_type: ModelTypeEnum.rerank,
          label: { en_US: 'Rerank V3', zh_Hans: 'Rerank V3' },
        })],
      })],
      defaultModel: undefined,
    })
  })

  // Rendering behavior for mapped rerank model state.
  describe('Rendering', () => {
    it('should not pass a default model when reranking model fields are empty strings', () => {
      render(
        <RerankingModelSelector
          rerankingModel={{
            reranking_provider_name: '',
            reranking_model_name: '',
          }}
        />,
      )

      expect(screen.getByTestId('default-model')).toHaveTextContent('no-default-model')
      expect(screen.getByTestId('model-list-count')).toHaveTextContent('1')
    })

    it('should map reranking model to default model when both fields exist', () => {
      render(
        <RerankingModelSelector
          rerankingModel={{
            reranking_provider_name: 'cohere',
            reranking_model_name: 'rerank-v3',
          }}
        />,
      )

      expect(screen.getByTestId('default-model')).toHaveTextContent('cohere/rerank-v3')
    })
  })

  // Selection behavior should convert back to workflow reranking model shape.
  describe('Interactions', () => {
    it('should map selected model back to reranking model fields', () => {
      const onRerankingModelChange = vi.fn()

      render(<RerankingModelSelector onRerankingModelChange={onRerankingModelChange} />)

      fireEvent.click(screen.getByRole('button', { name: 'select-model' }))

      expect(onRerankingModelChange).toHaveBeenCalledWith({
        reranking_provider_name: 'cohere',
        reranking_model_name: 'rerank-v3',
      })
    })
  })
})
