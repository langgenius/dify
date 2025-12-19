import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfigAudio from './config-audio'
import type { FeatureStoreState } from '@/app/components/base/features/store'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'

const mockUseContext = jest.fn()
jest.mock('use-context-selector', () => {
  const actual = jest.requireActual('use-context-selector')
  return {
    ...actual,
    useContext: (context: unknown) => mockUseContext(context),
  }
})

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const mockUseFeatures = jest.fn()
const mockUseFeaturesStore = jest.fn()
jest.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: FeatureStoreState) => any) => mockUseFeatures(selector),
  useFeaturesStore: () => mockUseFeaturesStore(),
}))

type SetupOptions = {
  isVisible?: boolean
  allowedTypes?: SupportUploadFileTypes[]
}

let mockFeatureStoreState: FeatureStoreState
let mockSetFeatures: jest.Mock
const mockStore = {
  getState: jest.fn<FeatureStoreState, []>(() => mockFeatureStoreState),
}

const setupFeatureStore = (allowedTypes: SupportUploadFileTypes[] = []) => {
  mockSetFeatures = jest.fn()
  mockFeatureStoreState = {
    features: {
      file: {
        allowed_file_types: allowedTypes,
        enabled: allowedTypes.length > 0,
      },
    },
    setFeatures: mockSetFeatures,
    showFeaturesModal: false,
    setShowFeaturesModal: jest.fn(),
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
  jest.clearAllMocks()
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
