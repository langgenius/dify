import type { ComponentProps, ReactElement } from 'react'
import { render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import {
  createModelConfigFixture,
  createPublishedConfigurationFixture,
} from '@/test/fixtures/debug-configuration'
import { Resolution, TransferMethod } from '@/types/app'
import FeaturesWrappedAppPublisher from '../features-wrapper'

const mockOnPublish = vi.fn()
const mockFeatures = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false, opening_statement: '', suggested_questions: [] as string[] },
  moderation: { enabled: false },
  speech2text: { enabled: false },
  text2speech: { enabled: false },
  suggested: { enabled: false },
  citation: { enabled: false },
  annotationReply: { enabled: false },
  file: {
    image: {
      detail: Resolution.high,
      enabled: false,
      number_limits: 3,
      transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
    },
    enabled: false,
    allowed_file_types: [SupportUploadFileTypes.image],
    allowed_file_extensions: ['.png'],
    allowed_file_upload_methods: [TransferMethod.local_file],
    number_limits: 3,
  },
}
vi.mock('@/app/components/app/app-publisher', () => ({
  AppPublisher: (
    props: ComponentProps<typeof import('@/app/components/app/app-publisher').AppPublisher>,
  ) => {
    return (
      <div>
        <button
          type="button"
          onClick={() =>
            props.onPublish?.({
              id: 'model-1',
              model: 'gpt-4o',
              provider: 'openai',
              parameters: {},
            })
          }
        >
          publish-through-wrapper
        </button>
        <button
          type="button"
          onClick={() => props.onPublish?.(undefined, { showSuccessToast: false })}
        >
          publish-silently-through-wrapper
        </button>
        <button type="button" onClick={() => props.onRestore?.()}>
          restore-through-wrapper
        </button>
      </div>
    )
  },
}))

let store: ReturnType<typeof createFeaturesStore>
function render(ui: ReactElement) {
  store = createFeaturesStore({ features: mockFeatures })
  return rtlRender(<FeaturesContext.Provider value={store}>{ui}</FeaturesContext.Provider>)
}

describe('FeaturesWrappedAppPublisher', () => {
  const resetAppConfig = vi.fn()
  const publishedConfig = createPublishedConfigurationFixture({
    modelConfig: createModelConfigFixture({
      more_like_this: { enabled: true },
      opening_statement: 'Hello there',
      suggested_questions: ['Q1'],
      sensitive_word_avoidance: { enabled: true },
      speech_to_text: { enabled: true },
      text_to_speech: { enabled: true },
      suggested_questions_after_answer: { enabled: true },
      retriever_resource: { enabled: true },
      annotation_reply: {
        enabled: true,
        id: 'annotation-1',
        score_threshold: 0.7,
        embedding_model: { embedding_model_name: 'embedding', embedding_provider_name: 'openai' },
      },
      file_upload: {
        enabled: true,
        image: {
          enabled: true,
          detail: 'low',
          number_limits: 5,
          transfer_methods: ['remote_url'],
        },
        allowed_file_types: [SupportUploadFileTypes.image],
        allowed_file_extensions: ['.jpg'],
        allowed_file_upload_methods: ['remote_url'],
        number_limits: 5,
      },
    }),
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should pass current features through to onPublish', async () => {
    const user = userEvent.setup()
    render(
      <FeaturesWrappedAppPublisher
        appId="app-1"
        publishedConfig={publishedConfig}
        onPublish={mockOnPublish}
      />,
    )

    await user.click(screen.getByText('publish-through-wrapper'))

    await waitFor(() => {
      expect(mockOnPublish).toHaveBeenCalledWith(
        { id: 'model-1', model: 'gpt-4o', provider: 'openai', parameters: {} },
        mockFeatures,
      )
    })
  })

  it('should pass publish notification options through to onPublish', async () => {
    const user = userEvent.setup()
    render(
      <FeaturesWrappedAppPublisher
        appId="app-1"
        publishedConfig={publishedConfig}
        onPublish={mockOnPublish}
      />,
    )

    await user.click(screen.getByText('publish-silently-through-wrapper'))

    await waitFor(() => {
      expect(mockOnPublish).toHaveBeenCalledWith(undefined, mockFeatures, {
        showSuccessToast: false,
      })
    })
  })

  it('should restore published features after confirmation', async () => {
    const user = userEvent.setup()
    render(
      <FeaturesWrappedAppPublisher
        appId="app-1"
        publishedConfig={publishedConfig}
        resetAppConfig={resetAppConfig}
      />,
    )

    await user.click(screen.getByText('restore-through-wrapper'))
    expect(store.getState().features).toEqual(mockFeatures)
    expect(resetAppConfig).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.confirm(?=$|:)/ }))

    await waitFor(() => {
      expect(resetAppConfig).toHaveBeenCalledTimes(1)
      expect(store.getState().features).toEqual(
        expect.objectContaining({
          moreLikeThis: { enabled: true },
          opening: {
            enabled: true,
            opening_statement: 'Hello there',
            suggested_questions: ['Q1'],
          },
          moderation: { enabled: true },
          speech2text: { enabled: true },
          text2speech: { enabled: true },
          suggested: { enabled: true },
          citation: { enabled: true },
          annotationReply: publishedConfig.modelConfig.annotation_reply,
          file: publishedConfig.modelConfig.file_upload,
        }),
      )
    })
  })

  it('should close restore confirmation without restoring when cancelled', async () => {
    const user = userEvent.setup()
    render(
      <FeaturesWrappedAppPublisher
        appId="app-1"
        publishedConfig={publishedConfig}
        resetAppConfig={resetAppConfig}
      />,
    )

    await user.click(screen.getByText('restore-through-wrapper'))
    const dialog = screen.getByRole('alertdialog')

    await user.click(
      within(dialog).getByRole('button', { name: /(?:^|\.)operation\.cancel(?=$|:)/ }),
    )

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(resetAppConfig).not.toHaveBeenCalled()
    expect(store.getState().features).toEqual(mockFeatures)
  })
})
