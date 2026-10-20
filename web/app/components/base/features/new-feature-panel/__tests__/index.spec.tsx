import type { Features } from '../../types'
import { screen } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { FeaturesProvider } from '../../context'
import NewFeaturePanel from '../index'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'codeBasedExtension.get': async () => undefined,
    }),
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/app/test-app-id/configuration',
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

const renderPanel = (
  props: Partial<{
    show: boolean
    isChatMode: boolean
    disabled: boolean
    onChange: () => void
    onClose: () => void
    inWorkflow: boolean
    showFileUpload: boolean
    showAnnotationReply: boolean
  }> = {},
  searchParams = '',
) => {
  const queryClient = createConsoleQueryClient()
  const models = [
    createCatalogModelFixture({ model: 'text-embedding-ada-002', model_type: 'text-embedding' }),
    createCatalogModelFixture({ model: 'whisper-1', model_type: 'speech2text' }),
    createCatalogModelFixture({ model: 'tts-1', model_type: 'tts' }),
  ]
  seedModelProviderQueries(queryClient, [createModelCatalogFixture({ models })])
  for (const model of models) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.defaultModel.get.queryKey({
        input: { query: { model_type: model.model_type } },
      }),
      {
        data: createDefaultModelFixture({ model: model.model, model_type: model.model_type }),
      },
    )
  }
  return renderWithConsoleQuery(
    <NuqsTestingAdapter searchParams={searchParams}>
      <FeaturesProvider features={defaultFeatures}>
        <NewFeaturePanel
          show={props.show ?? true}
          isChatMode={props.isChatMode ?? true}
          disabled={props.disabled ?? false}
          onChange={props.onChange}
          onClose={props.onClose ?? vi.fn()}
          inWorkflow={props.inWorkflow}
          showFileUpload={props.showFileUpload}
          showAnnotationReply={props.showAnnotationReply}
        />
      </FeaturesProvider>
    </NuqsTestingAdapter>,
    { queryClient },
  )
}

describe('NewFeaturePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('hides the feature drawer while pricing is open', () => {
      renderPanel({ show: true }, '?pricing=open')
      expect(screen.queryByText(/common\.featuresDescription/)).not.toBeInTheDocument()
    })

    it('should not render when show is false', () => {
      renderPanel({ show: false })

      expect(screen.queryByText(/common\.features/)).not.toBeInTheDocument()
    })
  })

  it('names each configuration feature switch from its visible title', () => {
    renderPanel({ isChatMode: true, inWorkflow: false, showFileUpload: false })
    expect(screen.getByRole('dialog', { name: 'workflow.common.features' })).toBeInTheDocument()

    for (const feature of [
      'conversationOpener',
      'suggestedQuestionsAfterAnswer',
      'citation',
      'moderation',
      'annotation',
    ]) {
      expect(
        screen.getByRole('switch', { name: `appDebug.feature.${feature}.title` }),
      ).toBeInTheDocument()
    }
  })

  describe('Chat Mode Features', () => {
    it('should render speech-to-text in chat mode when model is available', () => {
      renderPanel({ isChatMode: true })

      expect(screen.getByText(/feature\.speechToText\.title/)).toBeInTheDocument()
    })

    it('should render text-to-speech in chat mode when model is available', () => {
      renderPanel({ isChatMode: true })

      expect(screen.getByText(/feature\.textToSpeech\.title/)).toBeInTheDocument()
    })
  })

  describe('File Upload', () => {
    it('should render file upload in chat mode with showFileUpload', () => {
      renderPanel({ isChatMode: true, showFileUpload: true })

      expect(screen.getByText(/feature\.fileUpload\.title/)).toBeInTheDocument()
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
    it('should not render AnnotationReply in workflow mode', () => {
      renderPanel({ isChatMode: true, inWorkflow: true })

      expect(screen.queryByText(/feature\.annotation\.title/)).not.toBeInTheDocument()
    })

    it('should not render AnnotationReply when showAnnotationReply is false', () => {
      renderPanel({ isChatMode: true, inWorkflow: false, showAnnotationReply: false })

      expect(screen.queryByText(/feature\.annotation\.title/)).not.toBeInTheDocument()
    })
  })
})
