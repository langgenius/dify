import type { Features } from '../types'
import { render, screen } from '@testing-library/react'
import { FeaturesProvider } from '../context'
import NewFeaturePanel from './index'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: (type: string) => {
    if (type === 'speech2text' || type === 'tts')
      return { data: { provider: 'openai', model: 'whisper-1' } }
    return { data: null }
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/declarations', () => ({
  ModelTypeEnum: {
    speech2text: 'speech2text',
    tts: 'tts',
  },
}))

// Mock all feature sub-components to simplify testing the orchestrator
vi.mock('@/app/components/base/features/new-feature-panel/annotation-reply', () => ({
  default: () => <div data-testid="annotation-reply">AnnotationReply</div>,
}))
vi.mock('@/app/components/base/features/new-feature-panel/citation', () => ({
  default: () => <div data-testid="citation">Citation</div>,
}))
vi.mock('@/app/components/base/features/new-feature-panel/conversation-opener', () => ({
  default: () => <div data-testid="conversation-opener">ConversationOpener</div>,
}))
vi.mock('@/app/components/base/features/new-feature-panel/file-upload', () => ({
  default: () => <div data-testid="file-upload">FileUpload</div>,
}))
vi.mock('@/app/components/base/features/new-feature-panel/follow-up', () => ({
  default: () => <div data-testid="follow-up">FollowUp</div>,
}))
vi.mock('@/app/components/base/features/new-feature-panel/image-upload', () => ({
  default: () => <div data-testid="image-upload">ImageUpload</div>,
}))
vi.mock('@/app/components/base/features/new-feature-panel/moderation', () => ({
  default: () => <div data-testid="moderation">Moderation</div>,
}))
vi.mock('@/app/components/base/features/new-feature-panel/more-like-this', () => ({
  default: () => <div data-testid="more-like-this">MoreLikeThis</div>,
}))
vi.mock('@/app/components/base/features/new-feature-panel/speech-to-text', () => ({
  default: () => <div data-testid="speech-to-text">SpeechToText</div>,
}))
vi.mock('@/app/components/base/features/new-feature-panel/text-to-speech', () => ({
  default: () => <div data-testid="text-to-speech">TextToSpeech</div>,
}))

const defaultFeatures: Features = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false },
  suggested: { enabled: false },
  text2speech: { enabled: false },
  speech2text: { enabled: false },
  citation: { enabled: false },
  moderation: { enabled: false },
  file: { enabled: false },
  annotationReply: { enabled: false },
}

const renderPanel = (props: Partial<{
  show: boolean
  isChatMode: boolean
  disabled: boolean
  onChange: () => void
  onClose: () => void
  inWorkflow: boolean
  showFileUpload: boolean
}> = {}) => {
  return render(
    <FeaturesProvider features={defaultFeatures}>
      <NewFeaturePanel
        show={props.show ?? true}
        isChatMode={props.isChatMode ?? true}
        disabled={props.disabled ?? false}
        onChange={props.onChange}
        onClose={props.onClose ?? vi.fn()}
        inWorkflow={props.inWorkflow}
        showFileUpload={props.showFileUpload}
      />
    </FeaturesProvider>,
  )
}

describe('NewFeaturePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not render when show is false', () => {
    renderPanel({ show: false })

    expect(screen.queryByText(/common\.features/)).not.toBeInTheDocument()
  })

  it('should render header with title and description when show is true', () => {
    renderPanel({ show: true })

    expect(screen.getByText(/common\.featuresDescription/)).toBeInTheDocument()
    // The title "common.features" text also matches the description, so use getAllBy
    expect(screen.getAllByText(/common\.features/).length).toBeGreaterThanOrEqual(1)
  })

  it('should show chat mode features: opener, follow-up, citation, speech', () => {
    renderPanel({ isChatMode: true })

    expect(screen.getByTestId('conversation-opener')).toBeInTheDocument()
    expect(screen.getByTestId('follow-up')).toBeInTheDocument()
    expect(screen.getByTestId('citation')).toBeInTheDocument()
    expect(screen.getByTestId('speech-to-text')).toBeInTheDocument()
    expect(screen.getByTestId('text-to-speech')).toBeInTheDocument()
    expect(screen.getByTestId('moderation')).toBeInTheDocument()
  })

  it('should show file upload in chat mode with showFileUpload', () => {
    renderPanel({ isChatMode: true, showFileUpload: true })

    expect(screen.getByTestId('file-upload')).toBeInTheDocument()
    expect(screen.queryByTestId('image-upload')).not.toBeInTheDocument()
  })

  it('should show image upload in non-chat mode with showFileUpload', () => {
    renderPanel({ isChatMode: false, showFileUpload: true })

    expect(screen.queryByTestId('file-upload')).not.toBeInTheDocument()
    expect(screen.getByTestId('image-upload')).toBeInTheDocument()
  })

  it('should not show file upload when showFileUpload is false', () => {
    renderPanel({ isChatMode: true, showFileUpload: false })

    expect(screen.queryByTestId('file-upload')).not.toBeInTheDocument()
    expect(screen.queryByTestId('image-upload')).not.toBeInTheDocument()
  })

  it('should show MoreLikeThis in non-chat, non-workflow mode', () => {
    renderPanel({ isChatMode: false, inWorkflow: false })

    expect(screen.getByTestId('more-like-this')).toBeInTheDocument()
  })

  it('should not show MoreLikeThis in chat mode', () => {
    renderPanel({ isChatMode: true, inWorkflow: false })

    expect(screen.queryByTestId('more-like-this')).not.toBeInTheDocument()
  })

  it('should not show MoreLikeThis in workflow mode', () => {
    renderPanel({ isChatMode: false, inWorkflow: true })

    expect(screen.queryByTestId('more-like-this')).not.toBeInTheDocument()
  })

  it('should show AnnotationReply only in chat mode when not in workflow', () => {
    renderPanel({ isChatMode: true, inWorkflow: false })

    expect(screen.getByTestId('annotation-reply')).toBeInTheDocument()
  })

  it('should not show AnnotationReply in workflow mode', () => {
    renderPanel({ isChatMode: true, inWorkflow: true })

    expect(screen.queryByTestId('annotation-reply')).not.toBeInTheDocument()
  })

  it('should show file upload tip in chat mode with showFileUpload', () => {
    renderPanel({ isChatMode: true, showFileUpload: true })

    expect(screen.getByText(/common\.fileUploadTip/)).toBeInTheDocument()
  })

  it('should show image upload legacy tip in non-chat mode with showFileUpload', () => {
    renderPanel({ isChatMode: false, showFileUpload: true })

    expect(screen.getByText(/common\.ImageUploadLegacyTip/)).toBeInTheDocument()
  })
})
