import type {
  AgentFileUploadFeatureConfig,
  AgentSoulAppFeaturesConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { Resolution } from '@/types/app'
import { AgentChatFeaturesPanel } from '../chat-features-panel'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({ data: null }),
}))

const baseFileUpload: AgentFileUploadFeatureConfig = {
  enabled: true,
  allowed_file_types: [SupportUploadFileTypes.image],
  allowed_file_upload_methods: ['local_file', 'remote_url'],
  number_limits: 3,
  image: {
    enabled: true,
    detail: Resolution.high,
  },
}

const createFileUpload = (
  overrides: Partial<AgentFileUploadFeatureConfig> = {},
): AgentFileUploadFeatureConfig => ({
  ...baseFileUpload,
  ...overrides,
  image: {
    ...baseFileUpload.image,
    ...overrides.image,
  },
})

function renderPanel(
  options: {
    fileUpload?: AgentFileUploadFeatureConfig
    supportsVision?: boolean
  } = {},
) {
  const fileUpload = options.fileUpload ?? createFileUpload()
  const supportsVision = Object.hasOwn(options, 'supportsVision') ? options.supportsVision : true
  const store = createStore()
  const appFeatures: AgentSoulAppFeaturesConfig = { file_upload: fileUpload }
  store.set(agentComposerDraftAtom, {
    ...defaultAgentSoulConfigFormState,
    appFeatures,
  })

  return {
    store,
    ...render(
      <JotaiProvider store={store}>
        <AgentChatFeaturesPanel
          show
          appFeatures={appFeatures}
          onClose={vi.fn()}
          supportsVision={supportsVision}
        />
      </JotaiProvider>,
    ),
  }
}

const getVisionWarning = () => screen.queryByText('appDebug.vision.onlySupportVisionModelTip')
const getResolutionLabel = () => screen.queryByText('appDebug.vision.visionSettings.resolution')

describe('AgentChatFeaturesPanel vision settings', () => {
  it('shows resolution controls for an image-enabled feature with a vision model', () => {
    renderPanel({ supportsVision: true })

    expect(getResolutionLabel()).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'appDebug.vision.visionSettings.high' }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(getVisionWarning()).not.toBeInTheDocument()
  })

  it('shows a non-blocking warning without changing enabled file uploads for a non-vision model', () => {
    const { store } = renderPanel({ supportsVision: false })

    expect(getVisionWarning()).toBeInTheDocument()
    expect(screen.getByText('appDebug.feature.fileUpload.supportedTypes')).toBeInTheDocument()
    expect(screen.getByText(SupportUploadFileTypes.image)).toBeInTheDocument()
    expect(store.get(agentComposerDraftAtom).appFeatures?.file_upload?.allowed_file_types).toEqual([
      SupportUploadFileTypes.image,
    ])
  })

  it('does not show vision settings for document-only file types even when image state is enabled', () => {
    renderPanel({
      supportsVision: false,
      fileUpload: createFileUpload({
        allowed_file_types: [SupportUploadFileTypes.document],
        image: { enabled: true },
      }),
    })

    expect(getVisionWarning()).not.toBeInTheDocument()
    expect(getResolutionLabel()).not.toBeInTheDocument()
    expect(screen.getByText(SupportUploadFileTypes.document)).toBeInTheDocument()
  })

  it('does not fall back to image state when allowed file types is explicitly empty', () => {
    renderPanel({
      supportsVision: false,
      fileUpload: createFileUpload({
        allowed_file_types: [],
        image: { enabled: true },
      }),
    })

    expect(getVisionWarning()).not.toBeInTheDocument()
    expect(getResolutionLabel()).not.toBeInTheDocument()
  })

  it('falls back to image state when allowed file types are undefined', () => {
    renderPanel({
      supportsVision: false,
      fileUpload: createFileUpload({
        allowed_file_types: undefined,
        image: { enabled: true },
      }),
    })

    expect(getVisionWarning()).toBeInTheDocument()
    expect(getResolutionLabel()).not.toBeInTheDocument()
  })

  it('updates only image resolution and syncs the Agent V2 app features draft', async () => {
    const user = userEvent.setup()
    const { store } = renderPanel({
      fileUpload: createFileUpload({
        allowed_file_extensions: ['.png'],
        number_limits: 2,
      }),
    })

    await user.click(screen.getByText('appDebug.vision.visionSettings.low'))

    expect(
      screen.getByRole('radio', { name: 'appDebug.vision.visionSettings.low' }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(store.get(agentComposerDraftAtom).appFeatures?.file_upload).toEqual(
      expect.objectContaining({
        allowed_file_extensions: ['.png'],
        allowed_file_types: [SupportUploadFileTypes.image],
        allowed_file_upload_methods: ['local_file', 'remote_url'],
        number_limits: 2,
        image: expect.objectContaining({
          enabled: true,
          detail: Resolution.low,
        }),
      }),
    )
  })

  it('renders neither warning nor resolution controls while model vision capability is unresolved', () => {
    renderPanel({ supportsVision: undefined })

    expect(getVisionWarning()).not.toBeInTheDocument()
    expect(getResolutionLabel()).not.toBeInTheDocument()
  })
})
