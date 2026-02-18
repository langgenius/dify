import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Toast from '@/app/components/base/toast'
import ConfigParamModal from './config-param-modal'

let mockHooksReturn: {
  modelList: { provider: { provider: string }, models: { model: string }[] }[]
  defaultModel: { provider: { provider: string }, model: string } | undefined
  currentModel: boolean | undefined
} = {
  modelList: [{ provider: { provider: 'openai' }, models: [{ model: 'text-embedding-ada-002' }] }],
  defaultModel: { provider: { provider: 'openai' }, model: 'text-embedding-ada-002' },
  currentModel: true,
}

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => mockHooksReturn,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/declarations', () => ({
  ModelTypeEnum: {
    textEmbedding: 'text-embedding',
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({ defaultModel, onSelect }: { defaultModel?: { provider: string, model: string }, onSelect: (val: { provider: string, model: string }) => void }) => (
    <div data-testid="model-selector" data-provider={defaultModel?.provider} data-model={defaultModel?.model}>
      Model Selector
      <button data-testid="select-model" onClick={() => onSelect({ provider: 'cohere', model: 'embed-english' })}>Select</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
}))

vi.mock('@/config', () => ({
  ANNOTATION_DEFAULT: { score_threshold: 0.9 },
}))

const defaultAnnotationConfig = {
  id: 'test-id',
  enabled: false,
  score_threshold: 0.9,
  embedding_model: {
    embedding_provider_name: 'openai',
    embedding_model_name: 'text-embedding-ada-002',
  },
}

describe('ConfigParamModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHooksReturn = {
      modelList: [{ provider: { provider: 'openai' }, models: [{ model: 'text-embedding-ada-002' }] }],
      defaultModel: { provider: { provider: 'openai' }, model: 'text-embedding-ada-002' },
      currentModel: true,
    }
  })

  it('should not render when isShow is false', () => {
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={false}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    expect(screen.queryByText(/initSetup/)).not.toBeInTheDocument()
  })

  it('should render init title when isInit is true', () => {
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        isInit={true}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    expect(screen.getByText(/initSetup\.title/)).toBeInTheDocument()
  })

  it('should render config title when isInit is false', () => {
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        isInit={false}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    expect(screen.getByText(/initSetup\.configTitle/)).toBeInTheDocument()
  })

  it('should render score slider', () => {
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('should render model selector', () => {
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
  })

  it('should render cancel and confirm buttons', () => {
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        isInit={true}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    expect(screen.getByText(/operation\.cancel/)).toBeInTheDocument()
    expect(screen.getByText(/initSetup\.confirmBtn/)).toBeInTheDocument()
  })

  it('should display score threshold value', () => {
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    expect(screen.getByText('0.90')).toBeInTheDocument()
  })

  it('should render configConfirmBtn when isInit is false', () => {
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        isInit={false}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    expect(screen.getByText(/initSetup\.configConfirmBtn/)).toBeInTheDocument()
  })

  it('should call onSave with embedding model and score when save is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={onSave}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    // Click the confirm/save button
    const buttons = screen.getAllByRole('button')
    const saveBtn = buttons.find(b => b.textContent?.includes('initSetup'))
    fireEvent.click(saveBtn!)

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        { embedding_provider_name: 'openai', embedding_model_name: 'text-embedding-ada-002' },
        0.9,
      )
    })
  })

  it('should show error toast when embedding model is not set', () => {
    const configWithoutModel = {
      ...defaultAnnotationConfig,
      embedding_model: undefined as unknown as typeof defaultAnnotationConfig.embedding_model,
    }

    // Override hooks to return no default model and no valid current model
    mockHooksReturn = {
      modelList: [],
      defaultModel: undefined,
      currentModel: undefined,
    }

    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={configWithoutModel}
      />,
    )

    const buttons = screen.getAllByRole('button')
    const saveBtn = buttons.find(b => b.textContent?.includes('initSetup'))
    fireEvent.click(saveBtn!)

    expect(Toast.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
  })

  it('should call onHide when cancel is clicked and not loading', () => {
    const onHide = vi.fn()
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={onHide}
        onSave={vi.fn()}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.cancel/))

    expect(onHide).toHaveBeenCalled()
  })

  it('should render slider with expected bounds and current value', () => {
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuemin', '80')
    expect(slider).toHaveAttribute('aria-valuemax', '100')
    expect(slider).toHaveAttribute('aria-valuenow', '90')
  })

  it('should update embedding model when model selector is used', () => {
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    // Click the select model button in mock
    fireEvent.click(screen.getByTestId('select-model'))

    // Model selector should now show the new provider/model
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-provider', 'cohere')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-model', 'embed-english')
  })

  it('should call onSave with updated score from annotation config', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={onSave}
        annotationConfig={{
          ...defaultAnnotationConfig,
          score_threshold: 0.95,
        }}
      />,
    )

    // Save
    const buttons = screen.getAllByRole('button')
    const saveBtn = buttons.find(b => b.textContent?.includes('initSetup'))
    fireEvent.click(saveBtn!)

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ embedding_provider_name: 'openai' }),
        0.95,
      )
    })
  })

  it('should call onSave with updated model after model selector change', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={onSave}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    // Change model
    fireEvent.click(screen.getByTestId('select-model'))

    // Save
    const buttons = screen.getAllByRole('button')
    const saveBtn = buttons.find(b => b.textContent?.includes('initSetup'))
    fireEvent.click(saveBtn!)

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        { embedding_provider_name: 'cohere', embedding_model_name: 'embed-english' },
        0.9,
      )
    })
  })

  it('should use default model when annotation config has no embedding model', () => {
    const configWithoutModel = {
      ...defaultAnnotationConfig,
      embedding_model: undefined as unknown as typeof defaultAnnotationConfig.embedding_model,
    }
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={configWithoutModel}
      />,
    )

    // Model selector should be initialized with the default model
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-provider', 'openai')
    expect(screen.getByTestId('model-selector')).toHaveAttribute('data-model', 'text-embedding-ada-002')
  })

  it('should use ANNOTATION_DEFAULT score_threshold when config has no score_threshold', () => {
    const configWithoutThreshold = {
      ...defaultAnnotationConfig,
      score_threshold: 0,
    }
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={configWithoutThreshold}
      />,
    )

    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '90')
  })

  it('should set loading state while saving', async () => {
    let resolveOnSave: () => void
    const onSave = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      resolveOnSave = resolve
    }))
    const onHide = vi.fn()

    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={onHide}
        onSave={onSave}
        annotationConfig={defaultAnnotationConfig}
      />,
    )

    // Click save
    const buttons = screen.getAllByRole('button')
    const saveBtn = buttons.find(b => b.textContent?.includes('initSetup'))
    fireEvent.click(saveBtn!)

    // While loading, clicking cancel should not call onHide
    fireEvent.click(screen.getByText(/operation\.cancel/))
    expect(onHide).not.toHaveBeenCalled()

    // Resolve the save
    resolveOnSave!()
    await waitFor(() => {
      expect(onSave).toHaveBeenCalled()
    })
  })
})
