import type { Features } from '../../types'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { FeaturesProvider } from '../../context'
import AnnotationReply from './index'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/app/test-app-id/configuration',
}))

let mockIsShowAnnotationConfigInit = false
let mockIsShowAnnotationFullModal = false
const mockHandleEnableAnnotation = vi.fn().mockResolvedValue(undefined)
const mockHandleDisableAnnotation = vi.fn().mockResolvedValue(undefined)
const mockSetIsShowAnnotationConfigInit = vi.fn((v: boolean) => {
  mockIsShowAnnotationConfigInit = v
})
const mockSetIsShowAnnotationFullModal = vi.fn((v: boolean) => {
  mockIsShowAnnotationFullModal = v
})

let capturedSetAnnotationConfig: ((config: Record<string, unknown>) => void) | null = null

vi.mock('@/app/components/base/features/new-feature-panel/annotation-reply/use-annotation-config', () => ({
  default: ({ setAnnotationConfig }: { setAnnotationConfig: (config: Record<string, unknown>) => void }) => {
    capturedSetAnnotationConfig = setAnnotationConfig
    return {
      handleEnableAnnotation: mockHandleEnableAnnotation,
      handleDisableAnnotation: mockHandleDisableAnnotation,
      get isShowAnnotationConfigInit() { return mockIsShowAnnotationConfigInit },
      setIsShowAnnotationConfigInit: mockSetIsShowAnnotationConfigInit,
      get isShowAnnotationFullModal() { return mockIsShowAnnotationFullModal },
      setIsShowAnnotationFullModal: mockSetIsShowAnnotationFullModal,
    }
  },
}))

vi.mock('@/app/components/billing/annotation-full/modal', () => ({
  default: ({ show, onHide }: { show: boolean, onHide: () => void }) => (
    show
      ? (
          <div data-testid="annotation-full-modal">
            <button data-testid="full-hide" onClick={onHide}>Hide</button>
          </div>
        )
      : null
  ),
}))

vi.mock('@/config', () => ({
  ANNOTATION_DEFAULT: { score_threshold: 0.9 },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    modelList: [{ provider: { provider: 'openai' }, models: [{ model: 'text-embedding-ada-002' }] }],
    defaultModel: { provider: { provider: 'openai' }, model: 'text-embedding-ada-002' },
    currentModel: true,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/declarations', () => ({
  ModelTypeEnum: {
    textEmbedding: 'text-embedding',
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: () => (
    <div data-testid="model-selector">Model Selector</div>
  ),
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

const renderWithProvider = (
  props: { disabled?: boolean, onChange?: OnFeaturesChange } = {},
  featureOverrides?: Partial<Features>,
) => {
  const features = { ...defaultFeatures, ...featureOverrides }
  return render(
    <FeaturesProvider features={features}>
      <AnnotationReply disabled={props.disabled} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

describe('AnnotationReply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsShowAnnotationConfigInit = false
    mockIsShowAnnotationFullModal = false
    capturedSetAnnotationConfig = null
  })

  it('should render the annotation reply title', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.annotation\.title/)).toBeInTheDocument()
  })

  it('should render description when not enabled', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.annotation\.description/)).toBeInTheDocument()
  })

  it('should render a switch toggle', () => {
    renderWithProvider()

    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('should call setIsShowAnnotationConfigInit when switch is toggled on', () => {
    renderWithProvider()

    fireEvent.click(screen.getByRole('switch'))

    expect(mockSetIsShowAnnotationConfigInit).toHaveBeenCalledWith(true)
  })

  it('should call handleDisableAnnotation when switch is toggled off', () => {
    renderWithProvider({}, {
      annotationReply: {
        enabled: true,
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-ada-002',
        },
      },
    })

    fireEvent.click(screen.getByRole('switch'))

    expect(mockHandleDisableAnnotation).toHaveBeenCalled()
  })

  it('should show score threshold and embedding model when enabled', () => {
    renderWithProvider({}, {
      annotationReply: {
        enabled: true,
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-ada-002',
        },
      },
    })

    expect(screen.getByText('0.9')).toBeInTheDocument()
    expect(screen.getByText('text-embedding-ada-002')).toBeInTheDocument()
  })

  it('should show dash when score threshold is not set', () => {
    renderWithProvider({}, {
      annotationReply: {
        enabled: true,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-ada-002',
        },
      },
    })

    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('should show buttons when hovering over enabled feature', () => {
    renderWithProvider({}, {
      annotationReply: {
        enabled: true,
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-ada-002',
        },
      },
    })

    const card = screen.getByText(/feature\.annotation\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    expect(screen.getByText(/operation\.params/)).toBeInTheDocument()
    expect(screen.getByText(/feature\.annotation\.cacheManagement/)).toBeInTheDocument()
  })

  it('should call setIsShowAnnotationConfigInit when params button is clicked', () => {
    renderWithProvider({}, {
      annotationReply: {
        enabled: true,
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-ada-002',
        },
      },
    })

    const card = screen.getByText(/feature\.annotation\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/operation\.params/))

    expect(mockSetIsShowAnnotationConfigInit).toHaveBeenCalledWith(true)
  })

  it('should navigate to annotations page when cache management is clicked', () => {
    renderWithProvider({}, {
      annotationReply: {
        enabled: true,
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-ada-002',
        },
      },
    })

    const card = screen.getByText(/feature\.annotation\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.click(screen.getByText(/feature\.annotation\.cacheManagement/))

    expect(mockPush).toHaveBeenCalledWith('/app/test-app-id/annotations')
  })

  it('should show config param modal when isShowAnnotationConfigInit is true', () => {
    mockIsShowAnnotationConfigInit = true
    renderWithProvider()

    expect(screen.getByText(/initSetup\.title/)).toBeInTheDocument()
  })

  it('should hide config modal when hide is clicked', () => {
    mockIsShowAnnotationConfigInit = true
    renderWithProvider()

    fireEvent.click(screen.getByRole('button', { name: /operation\.cancel/ }))

    expect(mockSetIsShowAnnotationConfigInit).toHaveBeenCalledWith(false)
  })

  it('should call handleEnableAnnotation when config save is clicked', async () => {
    mockIsShowAnnotationConfigInit = true
    renderWithProvider({}, {
      annotationReply: {
        enabled: true,
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-ada-002',
        },
      },
    })

    fireEvent.click(screen.getByText(/initSetup\.confirmBtn/))

    expect(mockHandleEnableAnnotation).toHaveBeenCalled()
  })

  it('should show annotation full modal when isShowAnnotationFullModal is true', () => {
    mockIsShowAnnotationFullModal = true
    renderWithProvider()

    expect(screen.getByTestId('annotation-full-modal')).toBeInTheDocument()
  })

  it('should hide annotation full modal when hide is clicked', () => {
    mockIsShowAnnotationFullModal = true
    renderWithProvider()

    fireEvent.click(screen.getByTestId('full-hide'))

    expect(mockSetIsShowAnnotationFullModal).toHaveBeenCalledWith(false)
  })

  it('should call handleEnableAnnotation and hide config modal on save', async () => {
    mockIsShowAnnotationConfigInit = true
    renderWithProvider({}, {
      annotationReply: {
        enabled: true,
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-ada-002',
        },
      },
    })

    fireEvent.click(screen.getByText(/initSetup\.confirmBtn/))

    // handleEnableAnnotation should be called with embedding model and score
    expect(mockHandleEnableAnnotation).toHaveBeenCalledWith(
      { embedding_provider_name: 'openai', embedding_model_name: 'text-embedding-ada-002' },
      0.9,
    )

    // After save resolves, config init should be hidden
    await vi.waitFor(() => {
      expect(mockSetIsShowAnnotationConfigInit).toHaveBeenCalledWith(false)
    })
  })

  it('should update features and call onChange when updateAnnotationReply is invoked', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange }, {
      annotationReply: {
        enabled: true,
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-ada-002',
        },
      },
    })

    // The captured setAnnotationConfig is the component's updateAnnotationReply callback
    expect(capturedSetAnnotationConfig).not.toBeNull()
    capturedSetAnnotationConfig!({
      enabled: true,
      score_threshold: 0.8,
      embedding_model: {
        embedding_provider_name: 'openai',
        embedding_model_name: 'new-model',
      },
    })

    expect(onChange).toHaveBeenCalled()
  })

  it('should update features without calling onChange when onChange is not provided', () => {
    renderWithProvider({}, {
      annotationReply: {
        enabled: true,
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-ada-002',
        },
      },
    })

    // Should not throw when onChange is not provided
    expect(capturedSetAnnotationConfig).not.toBeNull()
    expect(() => {
      capturedSetAnnotationConfig!({
        enabled: true,
        score_threshold: 0.7,
      })
    }).not.toThrow()
  })

  it('should hide info display when hovering over enabled feature', () => {
    renderWithProvider({}, {
      annotationReply: {
        enabled: true,
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-ada-002',
        },
      },
    })

    // Before hover, info is visible
    expect(screen.getByText('0.9')).toBeInTheDocument()

    const card = screen.getByText(/feature\.annotation\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)

    // After hover, buttons shown instead of info
    expect(screen.getByText(/operation\.params/)).toBeInTheDocument()
    expect(screen.queryByText('0.9')).not.toBeInTheDocument()
  })

  it('should show info display again when mouse leaves', () => {
    renderWithProvider({}, {
      annotationReply: {
        enabled: true,
        score_threshold: 0.9,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-ada-002',
        },
      },
    })

    const card = screen.getByText(/feature\.annotation\.title/).closest('[class]')!
    fireEvent.mouseEnter(card)
    fireEvent.mouseLeave(card)

    expect(screen.getByText('0.9')).toBeInTheDocument()
  })

  it('should pass isInit prop to ConfigParamModal', () => {
    mockIsShowAnnotationConfigInit = true
    renderWithProvider()

    expect(screen.getByText(/initSetup\.confirmBtn/)).toBeInTheDocument()
    expect(screen.queryByText(/initSetup\.configConfirmBtn/)).not.toBeInTheDocument()
  })

  it('should not show annotation full modal when isShowAnnotationFullModal is false', () => {
    mockIsShowAnnotationFullModal = false
    renderWithProvider()

    expect(screen.queryByTestId('annotation-full-modal')).not.toBeInTheDocument()
  })
})
