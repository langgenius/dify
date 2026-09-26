import type { AppPublisherProps } from '../types'
import type { ModelAndParameter } from '@/app/components/app/configuration/debug/types'
import type { ConfigurationPublishConfig } from '@/app/components/app/configuration/hooks/configuration-lifecycle/types'
import type { Features } from '@/app/components/base/features/types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildConfigurationDefaults } from '@/app/components/app/configuration/hooks/configuration-lifecycle/load'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import FeaturesWrappedAppPublisher from '../features-wrapper'

const mockSetFeatures = vi.fn()
const mockOnPublish = vi.fn()
const modelAndParameter: ModelAndParameter = {
  id: 'model-1',
  provider: 'openai',
  model: 'gpt-4o',
  parameters: { temperature: 0.2 },
}
const mockFeatures: Features = {
  opening: { enabled: false, opening_statement: '', suggested_questions: [] },
  file: {
    fileUploadConfig: {
      image_file_size_limit: 17,
      batch_count_limit: 5,
      image_file_batch_limit: 10,
      single_chunk_attachment_limit: 10,
      attachment_image_file_size_limit: 10,
      file_size_limit: 15,
      file_upload_limit: 5,
    },
  },
}
vi.mock('@/app/components/app/app-publisher', () => ({
  AppPublisher: (props: AppPublisherProps) => (
    <div>
      <button type="button" onClick={() => props.onPublish?.(modelAndParameter)}>
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
  ),
}))
vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: { features: Features }) => unknown) =>
    selector({ features: mockFeatures }),
  useFeaturesStore: () => ({
    getState: () => ({ features: mockFeatures, setFeatures: mockSetFeatures }),
  }),
}))

const publishedConfig: ConfigurationPublishConfig = buildConfigurationDefaults({
  response: createAppDetailFixture({
    model_config: createAppModelConfigFixture({
      model: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
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
        score_threshold: 0.8,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-3-large',
        },
      },
      file_upload: {
        enabled: true,
        image: { enabled: true, detail: 'low', number_limits: 5, transfer_methods: ['remote_url'] },
        allowed_file_types: ['image'],
        allowed_file_extensions: ['.jpg'],
        allowed_file_upload_methods: ['remote_url'],
        number_limits: 5,
      },
    }),
  }),
  collections: [],
  nextDataSets: [],
}).publishedConfig

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const confirmRestore = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByText('restore-through-wrapper'))
  await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.confirm(?=$|:)/ }))
}

describe('FeaturesWrappedAppPublisher', () => {
  const resetAppConfig = vi.fn()
  const loadPublishedConfig = vi.fn<() => Promise<ConfigurationPublishConfig>>()
  const setup = () => ({
    user: userEvent.setup(),
    ...renderWithConsoleQuery(
      <FeaturesWrappedAppPublisher
        loadPublishedConfig={loadPublishedConfig}
        resetAppConfig={resetAppConfig}
        onPublish={mockOnPublish}
      />,
    ),
  })
  beforeEach(() => {
    vi.clearAllMocks()
    loadPublishedConfig.mockResolvedValue(publishedConfig)
  })

  it('passes current features through to publication', async () => {
    const { user } = setup()
    await user.click(screen.getByText('publish-through-wrapper'))
    await waitFor(() => expect(mockOnPublish).toHaveBeenCalledWith(modelAndParameter, mockFeatures))
  })

  it('passes publish notification options through', async () => {
    const { user } = setup()
    await user.click(screen.getByText('publish-silently-through-wrapper'))
    await waitFor(() =>
      expect(mockOnPublish).toHaveBeenCalledWith(undefined, mockFeatures, {
        showSuccessToast: false,
      }),
    )
  })

  it('applies one complete snapshot after loading and retains runtime upload limits', async () => {
    const pending = deferred<ConfigurationPublishConfig>()
    loadPublishedConfig.mockReturnValue(pending.promise)
    const { user } = setup()
    await confirmRestore(user)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /operation\.confirm/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(resetAppConfig).not.toHaveBeenCalled()
    expect(mockSetFeatures).not.toHaveBeenCalled()
    await act(async () => pending.resolve(publishedConfig))
    await waitFor(() => expect(resetAppConfig).toHaveBeenCalledWith(publishedConfig))
    expect(mockSetFeatures).toHaveBeenCalledWith(
      expect.objectContaining({
        moreLikeThis: { enabled: true },
        opening: { enabled: true, opening_statement: 'Hello there', suggested_questions: ['Q1'] },
        moderation: { enabled: true },
        speech2text: { enabled: true },
        text2speech: { enabled: true },
        suggested: { enabled: true },
        citation: { enabled: true },
        annotationReply: expect.objectContaining({ enabled: true }),
        file: expect.objectContaining({
          fileUploadConfig: mockFeatures.file?.fileUploadConfig,
          allowed_file_extensions: ['.jpg'],
        }),
      }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('keeps the confirmation open on failure and allows retry without applying old data', async () => {
    loadPublishedConfig.mockRejectedValueOnce(new Error('Unavailable'))
    const { user } = setup()
    await confirmRestore(user)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /operation\.confirm/ })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    expect(resetAppConfig).not.toHaveBeenCalled()
    expect(mockSetFeatures).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /operation\.confirm/ }))
    await waitFor(() => expect(resetAppConfig).toHaveBeenCalledWith(publishedConfig))
  })

  it('does not apply an old restore result after its owner unmounts', async () => {
    const pending = deferred<ConfigurationPublishConfig>()
    loadPublishedConfig.mockReturnValueOnce(pending.promise)
    const { unmount, user } = setup()
    await confirmRestore(user)
    await waitFor(() => expect(loadPublishedConfig).toHaveBeenCalledOnce())
    unmount()
    setup()
    await act(async () => pending.resolve(publishedConfig))
    expect(resetAppConfig).not.toHaveBeenCalled()
    expect(mockSetFeatures).not.toHaveBeenCalled()
  })

  it('closes the confirmation without loading when cancelled', async () => {
    const { user } = setup()
    await user.click(screen.getByText('restore-through-wrapper'))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: /operation\.cancel/ }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(loadPublishedConfig).not.toHaveBeenCalled()
    expect(resetAppConfig).not.toHaveBeenCalled()
    expect(mockSetFeatures).not.toHaveBeenCalled()
  })
})
