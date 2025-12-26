import type { Mock } from 'vitest'
import type { FeatureStoreState } from '@/app/components/base/features/store'
import type { FileUpload } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { Resolution, TransferMethod } from '@/types/app'
import ConfigVision from './index'
import ParamConfig from './param-config'
import ParamConfigContent from './param-config-content'

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

const defaultFile: FileUpload = {
  enabled: false,
  allowed_file_types: [],
  allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  number_limits: 3,
  image: {
    enabled: false,
    detail: Resolution.low,
    number_limits: 3,
    transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  },
}

let featureStoreState: FeatureStoreState
let setFeaturesMock: Mock

const setupFeatureStore = (fileOverrides: Partial<FileUpload> = {}) => {
  const mergedFile: FileUpload = {
    ...defaultFile,
    ...fileOverrides,
    image: {
      ...defaultFile.image,
      ...fileOverrides.image,
    },
  }
  featureStoreState = {
    features: {
      file: mergedFile,
    },
    setFeatures: vi.fn(),
    showFeaturesModal: false,
    setShowFeaturesModal: vi.fn(),
  }
  setFeaturesMock = featureStoreState.setFeatures as Mock
  mockUseFeaturesStore.mockReturnValue({
    getState: () => featureStoreState,
  })
  mockUseFeatures.mockImplementation(selector => selector(featureStoreState))
}

const getLatestFileConfig = () => {
  expect(setFeaturesMock).toHaveBeenCalled()
  const latestFeatures = setFeaturesMock.mock.calls[setFeaturesMock.mock.calls.length - 1][0] as { file: FileUpload }
  return latestFeatures.file
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseContext.mockReturnValue({
    isShowVisionConfig: true,
    isAllowVideoUpload: false,
  })
  setupFeatureStore()
})

// ConfigVision handles toggling file upload types + visibility rules.
describe('ConfigVision', () => {
  it('should not render when vision configuration is hidden', () => {
    mockUseContext.mockReturnValue({
      isShowVisionConfig: false,
      isAllowVideoUpload: false,
    })

    render(<ConfigVision />)

    expect(screen.queryByText('appDebug.vision.name')).not.toBeInTheDocument()
  })

  it('should show the toggle and parameter controls when visible', () => {
    render(<ConfigVision />)

    expect(screen.getByText('appDebug.vision.name')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('should enable both image and video uploads when toggled on with video support', async () => {
    const user = userEvent.setup()
    mockUseContext.mockReturnValue({
      isShowVisionConfig: true,
      isAllowVideoUpload: true,
    })
    setupFeatureStore({
      allowed_file_types: [],
    })

    render(<ConfigVision />)
    await user.click(screen.getByRole('switch'))

    const updatedFile = getLatestFileConfig()
    expect(updatedFile.allowed_file_types).toEqual([SupportUploadFileTypes.image, SupportUploadFileTypes.video])
    expect(updatedFile.image?.enabled).toBe(true)
    expect(updatedFile.enabled).toBe(true)
  })

  it('should disable image and video uploads when toggled off and no other types remain', async () => {
    const user = userEvent.setup()
    mockUseContext.mockReturnValue({
      isShowVisionConfig: true,
      isAllowVideoUpload: true,
    })
    setupFeatureStore({
      allowed_file_types: [SupportUploadFileTypes.image, SupportUploadFileTypes.video],
      enabled: true,
      image: {
        enabled: true,
      },
    })

    render(<ConfigVision />)
    await user.click(screen.getByRole('switch'))

    const updatedFile = getLatestFileConfig()
    expect(updatedFile.allowed_file_types).toEqual([])
    expect(updatedFile.enabled).toBe(false)
    expect(updatedFile.image?.enabled).toBe(false)
  })

  it('should keep file uploads enabled when other file types remain after disabling vision', async () => {
    const user = userEvent.setup()
    mockUseContext.mockReturnValue({
      isShowVisionConfig: true,
      isAllowVideoUpload: false,
    })
    setupFeatureStore({
      allowed_file_types: [SupportUploadFileTypes.image, SupportUploadFileTypes.document],
      enabled: true,
      image: { enabled: true },
    })

    render(<ConfigVision />)
    await user.click(screen.getByRole('switch'))

    const updatedFile = getLatestFileConfig()
    expect(updatedFile.allowed_file_types).toEqual([SupportUploadFileTypes.document])
    expect(updatedFile.enabled).toBe(true)
    expect(updatedFile.image?.enabled).toBe(false)
  })
})

// ParamConfig exposes ParamConfigContent via an inline trigger.
describe('ParamConfig', () => {
  it('should toggle parameter panel when clicking the settings button', async () => {
    setupFeatureStore()
    const user = userEvent.setup()

    render(<ParamConfig />)

    expect(screen.queryByText('appDebug.vision.visionSettings.title')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'appDebug.voice.settings' }))

    expect(await screen.findByText('appDebug.vision.visionSettings.title')).toBeInTheDocument()
  })
})

// ParamConfigContent manages resolution, upload source, and count limits.
describe('ParamConfigContent', () => {
  it('should set resolution to high when the corresponding option is selected', async () => {
    const user = userEvent.setup()
    setupFeatureStore({
      image: { detail: Resolution.low },
    })

    render(<ParamConfigContent />)

    await user.click(screen.getByText('appDebug.vision.visionSettings.high'))

    const updatedFile = getLatestFileConfig()
    expect(updatedFile.image?.detail).toBe(Resolution.high)
  })

  it('should switch upload method to local only', async () => {
    const user = userEvent.setup()
    setupFeatureStore({
      allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
    })

    render(<ParamConfigContent />)

    await user.click(screen.getByText('appDebug.vision.visionSettings.localUpload'))

    const updatedFile = getLatestFileConfig()
    expect(updatedFile.allowed_file_upload_methods).toEqual([TransferMethod.local_file])
    expect(updatedFile.image?.transfer_methods).toEqual([TransferMethod.local_file])
  })

  it('should update upload limit value when input changes', async () => {
    setupFeatureStore({
      number_limits: 2,
    })

    render(<ParamConfigContent />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '4' } })

    const updatedFile = getLatestFileConfig()
    expect(updatedFile.number_limits).toBe(4)
    expect(updatedFile.image?.number_limits).toBe(4)
  })
})
