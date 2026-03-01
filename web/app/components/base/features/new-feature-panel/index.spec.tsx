import type { Features } from '../types'
import { render, screen } from '@testing-library/react'
import { FeaturesProvider } from '../context'
import NewFeaturePanel from './index'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/app/test-app-id/configuration',
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: (type: string) => {
    if (type === 'speech2text' || type === 'tts')
      return { data: { provider: 'openai', model: 'whisper-1' } }
    return { data: null }
  },
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    modelList: [{ provider: { provider: 'openai' }, models: [{ model: 'text-embedding-ada-002' }] }],
    defaultModel: { provider: { provider: 'openai' }, model: 'text-embedding-ada-002' },
    currentModel: true,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/declarations', () => ({
  ModelTypeEnum: {
    speech2text: 'speech2text',
    tts: 'tts',
    textEmbedding: 'text-embedding',
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: () => <div data-testid="model-selector">Model Selector</div>,
}))

vi.mock('@/service/use-common', () => ({
  useCodeBasedExtensions: () => ({ data: undefined }),
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

  describe('Rendering', () => {
    it('should not render when show is false', () => {
      renderPanel({ show: false })

      expect(screen.queryByText(/common\.features/)).not.toBeInTheDocument()
    })

    it('should render header with title and description when show is true', () => {
      renderPanel({ show: true })

      expect(screen.getByText(/common\.featuresDescription/)).toBeInTheDocument()
      expect(screen.getAllByText(/common\.features/).length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Chat Mode Features', () => {
    it('should render conversation opener in chat mode', () => {
      renderPanel({ isChatMode: true })

      expect(screen.getByText(/feature\.conversationOpener\.title/)).toBeInTheDocument()
    })

    it('should render follow-up in chat mode', () => {
      renderPanel({ isChatMode: true })

      expect(screen.getByText(/feature\.suggestedQuestionsAfterAnswer\.title/)).toBeInTheDocument()
    })

    it('should render citation in chat mode', () => {
      renderPanel({ isChatMode: true })

      expect(screen.getByText(/feature\.citation\.title/)).toBeInTheDocument()
    })

    it('should render speech-to-text in chat mode when model is available', () => {
      renderPanel({ isChatMode: true })

      expect(screen.getByText(/feature\.speechToText\.title/)).toBeInTheDocument()
    })

    it('should render text-to-speech in chat mode when model is available', () => {
      renderPanel({ isChatMode: true })

      expect(screen.getByText(/feature\.textToSpeech\.title/)).toBeInTheDocument()
    })

    it('should render moderation in chat mode', () => {
      renderPanel({ isChatMode: true })

      expect(screen.getByText(/feature\.moderation\.title/)).toBeInTheDocument()
    })
  })

  describe('File Upload', () => {
    it('should render file upload in chat mode with showFileUpload', () => {
      renderPanel({ isChatMode: true, showFileUpload: true })

      expect(screen.getByText(/feature\.fileUpload\.title/)).toBeInTheDocument()
    })

    it('should not render image upload in chat mode', () => {
      renderPanel({ isChatMode: true, showFileUpload: true })

      expect(screen.queryByText(/feature\.imageUpload\.title/)).not.toBeInTheDocument()
    })

    it('should render image upload in non-chat mode with showFileUpload', () => {
      renderPanel({ isChatMode: false, showFileUpload: true })

      expect(screen.queryByText(/feature\.fileUpload\.title/)).not.toBeInTheDocument()
      expect(screen.getByText(/feature\.imageUpload\.title/)).toBeInTheDocument()
    })

    it('should not render file upload when showFileUpload is false', () => {
      renderPanel({ isChatMode: true, showFileUpload: false })

      expect(screen.queryByText(/feature\.fileUpload\.title/)).not.toBeInTheDocument()
      expect(screen.queryByText(/feature\.imageUpload\.title/)).not.toBeInTheDocument()
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

  describe('MoreLikeThis Feature', () => {
    it('should render MoreLikeThis in non-chat, non-workflow mode', () => {
      renderPanel({ isChatMode: false, inWorkflow: false })

      expect(screen.getByText(/feature\.moreLikeThis\.title/)).toBeInTheDocument()
    })

    it('should not render MoreLikeThis in chat mode', () => {
      renderPanel({ isChatMode: true, inWorkflow: false })

      expect(screen.queryByText(/feature\.moreLikeThis\.title/)).not.toBeInTheDocument()
    })

    it('should not render MoreLikeThis in workflow mode', () => {
      renderPanel({ isChatMode: false, inWorkflow: true })

      expect(screen.queryByText(/feature\.moreLikeThis\.title/)).not.toBeInTheDocument()
    })
  })

  describe('Annotation Reply Feature', () => {
    it('should render AnnotationReply in chat mode when not in workflow', () => {
      renderPanel({ isChatMode: true, inWorkflow: false })

      expect(screen.getByText(/feature\.annotation\.title/)).toBeInTheDocument()
    })

    it('should not render AnnotationReply in workflow mode', () => {
      renderPanel({ isChatMode: true, inWorkflow: true })

      expect(screen.queryByText(/feature\.annotation\.title/)).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should not show file upload tip when showFileUpload is false', () => {
      renderPanel({ isChatMode: true, showFileUpload: false })

      expect(screen.queryByText(/common\.fileUploadTip/)).not.toBeInTheDocument()
    })
  })
})
