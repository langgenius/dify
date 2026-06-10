import type { FeatureStoreState } from '@/app/components/base/features/store'
import type { FileUpload } from '@/app/components/base/features/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Resolution, TransferMethod } from '@/types/app'
import ParamConfig from '../param-config'

const mockUseFeatures = vi.fn()
const mockUseFeaturesStore = vi.fn()

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: FeatureStoreState) => unknown) => mockUseFeatures(selector),
  useFeaturesStore: () => mockUseFeaturesStore(),
}))

const setupFeatureStore = (fileOverrides: Partial<FileUpload> = {}) => {
  const file: FileUpload = {
    enabled: true,
    allowed_file_types: [],
    allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
    number_limits: 3,
    image: {
      enabled: true,
      detail: Resolution.low,
      number_limits: 3,
      transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
    },
    ...fileOverrides,
  }
  const featureStoreState = {
    features: { file },
    setFeatures: vi.fn(),
    showFeaturesModal: false,
    setShowFeaturesModal: vi.fn(),
  } as unknown as FeatureStoreState
  mockUseFeatures.mockImplementation(selector => selector(featureStoreState))
  mockUseFeaturesStore.mockReturnValue({
    getState: () => featureStoreState,
  })
}

describe('ParamConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFeatureStore()
  })

  it('should toggle the settings panel when clicking the trigger', async () => {
    const user = userEvent.setup()
    render(<ParamConfig />)

    expect(screen.queryByText('appDebug.vision.visionSettings.title')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'appDebug.voice.settings' }))

    expect(await screen.findByText('appDebug.vision.visionSettings.title')).toBeInTheDocument()
  })
})
