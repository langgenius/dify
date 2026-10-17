import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import ConfigParamModal from '../config-param-modal'

let mockHooksReturn: {
  modelList: { provider: { provider: string }; models: { model: string }[] }[]
  defaultModel: { provider: { provider: string }; model: string } | undefined
  currentModel: boolean | undefined
} = {
  modelList: [{ provider: { provider: 'openai' }, models: [{ model: 'text-embedding-ada-002' }] }],
  defaultModel: { provider: { provider: 'openai' }, model: 'text-embedding-ada-002' },
  currentModel: true,
}

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => mockHooksReturn,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: ({
    value,
    onValueChange,
  }: {
    value?: { provider: string; model: string }
    onValueChange: (val: { provider: string; model: string }) => void
  }) => (
    <div data-testid="model-selector" data-provider={value?.provider} data-model={value?.model}>
      Model Selector
      <button
        data-testid="select-model"
        onClick={() => onValueChange({ provider: 'cohere', model: 'embed-english' })}
      >
        Select
      </button>
    </div>
  ),
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
  let toastErrorSpy: typeof toast.error

  beforeEach(() => {
    vi.clearAllMocks()
    toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')
    mockHooksReturn = {
      modelList: [
        { provider: { provider: 'openai' }, models: [{ model: 'text-embedding-ada-002' }] },
      ],
      defaultModel: { provider: { provider: 'openai' }, model: 'text-embedding-ada-002' },
      currentModel: true,
    }
  })

  afterEach(() => vi.restoreAllMocks())

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
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        { embedding_provider_name: 'openai', embedding_model_name: 'text-embedding-ada-002' },
        0.9,
      )
    })
  })

  it('should show error toast when embedding model is not set', async () => {
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

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))

    expect(toastErrorSpy).toHaveBeenCalledWith(
      'modelProvider.modelProvider.embeddingModel.required',
    )
  })

  it('should call onHide when cancel is clicked and not loading', async () => {
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

    await userEvent.setup().click(screen.getByText(/operation\.cancel/))

    expect(onHide).toHaveBeenCalled()
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
    await userEvent.setup().click(screen.getByTestId('select-model'))

    // Save
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))

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
    expect(screen.getByTestId('model-selector')).toHaveAttribute(
      'data-model',
      'text-embedding-ada-002',
    )
  })

  it('saves the displayed default threshold when the configuration omits it', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <ConfigParamModal
        appId="test-app"
        isShow
        onHide={vi.fn()}
        onSave={onSave}
        annotationConfig={{
          ...defaultAnnotationConfig,
          score_threshold: undefined as unknown as number,
        }}
      />,
    )
    expect(screen.getByRole('slider')).toHaveValue('0.9')
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))
    expect(onSave).toHaveBeenCalledWith(defaultAnnotationConfig.embedding_model, 0.9)
  })

  it('leaves the form usable after a failed save', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValue(undefined)
    const onHide = vi.fn()
    render(
      <ConfigParamModal
        appId="test-app"
        isShow
        onHide={onHide}
        onSave={onSave}
        annotationConfig={defaultAnnotationConfig}
      />,
    )
    const user = userEvent.setup()
    const save = screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ })
    await user.click(save)
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith('common.api.actionFailed'))
    await user.click(save)
    expect(onSave).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: /operation\.cancel/ }))
    expect(onHide).toHaveBeenCalledOnce()
  })

  it('should preserve zero score threshold instead of falling back to default', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={onSave}
        annotationConfig={{
          ...defaultAnnotationConfig,
          score_threshold: 0,
        }}
      />,
    )

    expect(screen.getByRole('slider')).toHaveValue('0')

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ embedding_provider_name: 'openai' }),
        0,
      )
    })
  })

  it('should set loading state while saving', async () => {
    let resolveOnSave: () => void
    const onSave = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveOnSave = resolve
        }),
    )
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
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))

    // While loading, clicking cancel should not call onHide
    await userEvent.setup().click(screen.getByText(/operation\.cancel/))
    expect(onHide).not.toHaveBeenCalled()

    // Resolve the save
    await act(async () => resolveOnSave!())
    await userEvent.setup().click(screen.getByRole('button', { name: /operation\.cancel/ }))
    expect(onHide).toHaveBeenCalledOnce()
  })

  it('should save updated score after slider changes', async () => {
    const user = userEvent.setup()
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

    const slider = screen.getByRole('slider')
    await user.click(slider)
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('0.91'))

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ embedding_provider_name: 'openai' }),
        0.91,
      )
    })
  })
})
