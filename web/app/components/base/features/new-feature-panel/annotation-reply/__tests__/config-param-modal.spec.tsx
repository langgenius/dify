import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import ConfigParamModal from '../config-param-modal'

let modelAvailable = true
const render = createNuqsTestRenderer((ui) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(
    queryClient,
    modelAvailable
      ? [
          createModelCatalogFixture({
            models: [
              createCatalogModelFixture({
                model: 'text-embedding-ada-002',
                label: { en_US: 'Ada Embedding' },
                model_type: 'text-embedding',
              }),
            ],
          }),
          createModelCatalogFixture({
            provider: 'cohere',
            models: [
              createCatalogModelFixture({
                model: 'embed-english',
                label: { en_US: 'English Embedding' },
                model_type: 'text-embedding',
              }),
            ],
          }),
        ]
      : [],
  )
  return renderWithConsoleQuery(ui, { queryClient })
})

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
    modelAvailable = true
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

    // Click the confirm/save button
    await user.click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        { embedding_provider_name: 'openai', embedding_model_name: 'text-embedding-ada-002' },
        0.9,
      )
    })
  })

  it('should show error toast when embedding model is not set', async () => {
    const user = userEvent.setup()
    const configWithoutModel = {
      ...defaultAnnotationConfig,
      embedding_model: { embedding_provider_name: '', embedding_model_name: '' },
    }

    modelAvailable = false

    render(
      <ConfigParamModal
        appId="test-app"
        isShow={true}
        onHide={vi.fn()}
        onSave={vi.fn()}
        annotationConfig={configWithoutModel}
      />,
    )

    await user.click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))

    expect(toastErrorSpy).toHaveBeenCalledWith(
      'modelProvider.modelProvider.embeddingModel.required',
    )
  })

  it('should call onHide when cancel is clicked and not loading', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByText(/operation\.cancel/))

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
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Ada Embedding/ }))
    await user.click(await screen.findByRole('button', { name: /English Embedding/ }))

    // Save
    await user.click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        { embedding_provider_name: 'cohere', embedding_model_name: 'embed-english' },
        0.9,
      )
    })
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
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ embedding_provider_name: 'openai' }),
        0,
      )
    })
  })

  it('should set loading state while saving', async () => {
    const user = userEvent.setup()
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
    await user.click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))

    // While loading, clicking cancel should not call onHide
    await user.click(screen.getByText(/operation\.cancel/))
    expect(onHide).not.toHaveBeenCalled()

    // Resolve the save
    await act(async () => resolveOnSave!())
    await user.click(screen.getByRole('button', { name: /operation\.cancel/ }))
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

    await user.click(screen.getByRole('button', { name: /initSetup\.configConfirmBtn/ }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ embedding_provider_name: 'openai' }),
        0.91,
      )
    })
  })
})
