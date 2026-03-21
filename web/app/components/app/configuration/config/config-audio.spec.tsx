import type { Mock } from 'vitest'
import type { FeatureStoreState } from '@/app/components/base/features/store'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import ConfigAudio from './config-audio'

const mockUseContext = vi.fn()
vi.mock('use-context-selector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('use-context-selector')>()
  return {
    ...actual,
    useContext: (context: unknown) => mockUseContext(context),
  }
})

const mockUseFeatures = vi.fn()
const mockUseFeaturesStore = vi.fn()
vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: FeatureStoreState) => any) => mockUseFeatures(selector),
  useFeaturesStore: () => mockUseFeaturesStore(),
}))

type SetupOptions = {
  isVisible?: boolean
  allowedTypes?: SupportUploadFileTypes[]
}

let mockFeatureStoreState: FeatureStoreState
let mockSetFeatures: Mock
const mockStore = {
  getState: vi.fn<() => FeatureStoreState>(() => mockFeatureStoreState),
}

const setupFeatureStore = (allowedTypes: SupportUploadFileTypes[] = []) => {
  mockSetFeatures = vi.fn()
  mockFeatureStoreState = {
    features: {
      file: {
        allowed_file_types: allowedTypes,
        enabled: allowedTypes.length > 0,
      },
    },
    setFeatures: mockSetFeatures,
    showFeaturesModal: false,
    setShowFeaturesModal: vi.fn(),
  }
  mockStore.getState.mockImplementation(() => mockFeatureStoreState)
  mockUseFeaturesStore.mockReturnValue(mockStore)
  mockUseFeatures.mockImplementation(selector => selector(mockFeatureStoreState))
}

const renderConfigAudio = (options: SetupOptions = {}) => {
  const {
    isVisible = true,
    allowedTypes = [],
  } = options
  setupFeatureStore(allowedTypes)
  mockUseContext.mockReturnValue({
    isShowAudioConfig: isVisible,
  })
  const user = userEvent.setup()
  render(<ConfigAudio />)
  return {
    user,
    setFeatures: mockSetFeatures,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ConfigAudio', () => {
  it('should not render when the audio configuration is hidden', () => {
    renderConfigAudio({ isVisible: false })

    expect(screen.queryByText('appDebug.feature.audioUpload.title')).not.toBeInTheDocument()
  })

  it('should display the audio toggle state based on feature store data', () => {
    renderConfigAudio({ allowedTypes: [SupportUploadFileTypes.audio] })

    expect(screen.getByText('appDebug.feature.audioUpload.title')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('should enable audio uploads when toggled on', async () => {
    const { user, setFeatures } = renderConfigAudio()
    const toggle = screen.getByRole('switch')

    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)

    expect(setFeatures).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({
        allowed_file_types: [SupportUploadFileTypes.audio],
        enabled: true,
      }),
    }))
  })

  it('should disable audio uploads and turn off file feature when last type is removed', async () => {
    const { user, setFeatures } = renderConfigAudio({ allowedTypes: [SupportUploadFileTypes.audio] })
    const toggle = screen.getByRole('switch')

    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(toggle)

    expect(setFeatures).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({
        allowed_file_types: [],
        enabled: false,
      }),
    }))
  })
})
