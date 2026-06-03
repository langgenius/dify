/* eslint-disable ts/no-explicit-any */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import FeaturesWrappedAppPublisher from '../features-wrapper'

const mockSetFeatures = vi.fn()
const mockOnPublish = vi.fn()
const mockAppPublisherProps = vi.hoisted(() => ({
  current: null as null | Record<string, any>,
}))

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
      detail: 'high',
      enabled: false,
      number_limits: 3,
      transfer_methods: ['local_file', 'remote_url'],
    },
    enabled: false,
    allowed_file_types: ['image'],
    allowed_file_extensions: ['.png'],
    allowed_file_upload_methods: ['local_file'],
    number_limits: 3,
  },
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/app/app-publisher', () => ({
  default: (props: Record<string, any>) => {
    mockAppPublisherProps.current = props
    return (
      <div>
        <button onClick={() => props.onPublish?.({ id: 'model-1' })}>publish-through-wrapper</button>
        <button onClick={() => props.onRestore?.()}>restore-through-wrapper</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: { features: typeof mockFeatures }) => unknown) => selector({ features: mockFeatures }),
  useFeaturesStore: () => ({
    getState: () => ({
      features: mockFeatures,
      setFeatures: mockSetFeatures,
    }),
  }),
}))

describe('FeaturesWrappedAppPublisher', () => {
  const publishedConfig = {
    modelConfig: {
      more_like_this: { enabled: true },
      opening_statement: 'Hello there',
      suggested_questions: ['Q1'],
      sensitive_word_avoidance: { enabled: true },
      speech_to_text: { enabled: true },
      text_to_speech: { enabled: true },
      suggested_questions_after_answer: { enabled: true },
      retriever_resource: { enabled: true },
      annotation_reply: { enabled: true },
      file_upload: {
        enabled: true,
        image: {
          enabled: true,
          detail: 'low',
          number_limits: 5,
          transfer_methods: ['remote_url'],
        },
        allowed_file_types: ['image'],
        allowed_file_extensions: ['.jpg'],
        allowed_file_upload_methods: ['remote_url'],
        number_limits: 5,
      },
      resetAppConfig: vi.fn(),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAppPublisherProps.current = null
  })

  it('should pass current features through to onPublish', async () => {
    render(
      <FeaturesWrappedAppPublisher
        publishedConfig={publishedConfig as any}
        onPublish={mockOnPublish}
      />,
    )

    fireEvent.click(screen.getByText('publish-through-wrapper'))

    await waitFor(() => {
      expect(mockOnPublish).toHaveBeenCalledWith({ id: 'model-1' }, mockFeatures)
    })
  })

  it('should restore published features after confirmation', async () => {
    render(
      <FeaturesWrappedAppPublisher
        publishedConfig={publishedConfig as any}
      />,
    )

    fireEvent.click(screen.getByText('restore-through-wrapper'))
    fireEvent.click(screen.getByRole('button', { name: 'operation.confirm' }))

    await waitFor(() => {
      expect(publishedConfig.modelConfig.resetAppConfig).toHaveBeenCalledTimes(1)
      expect(mockSetFeatures).toHaveBeenCalledWith(expect.objectContaining({
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
        annotationReply: { enabled: true },
      }))
    })
  })

  it('should close restore confirmation without restoring when cancelled', async () => {
    render(
      <FeaturesWrappedAppPublisher
        publishedConfig={publishedConfig as any}
      />,
    )

    fireEvent.click(screen.getByText('restore-through-wrapper'))
    const dialog = screen.getByRole('alertdialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'operation.cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(publishedConfig.modelConfig.resetAppConfig).not.toHaveBeenCalled()
    expect(mockSetFeatures).not.toHaveBeenCalled()
  })
})
