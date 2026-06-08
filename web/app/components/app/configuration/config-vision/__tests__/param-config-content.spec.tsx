import type { FeatureStoreState } from '@/app/components/base/features/store'
import type { FileUpload } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Resolution, TransferMethod } from '@/types/app'
import ParamConfigContent from '../param-config-content'

const mockUseFeatures = vi.fn()
const mockUseFeaturesStore = vi.fn()
const mockSetFeatures = vi.fn()

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
    setFeatures: mockSetFeatures,
    showFeaturesModal: false,
    setShowFeaturesModal: vi.fn(),
  } as unknown as FeatureStoreState

  mockUseFeatures.mockImplementation(selector => selector(featureStoreState))
  mockUseFeaturesStore.mockReturnValue({
    getState: () => featureStoreState,
  })
}

const getUpdatedFile = () => {
  expect(mockSetFeatures).toHaveBeenCalled()
  return mockSetFeatures.mock.calls.at(-1)?.[0].file as FileUpload
}

describe('ParamConfigContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFeatureStore()
  })

  it('should update the image resolution', async () => {
    const user = userEvent.setup()
    render(<ParamConfigContent />)

    await user.click(screen.getByText('appDebug.vision.visionSettings.high'))

    expect(getUpdatedFile().image?.detail).toBe(Resolution.high)
  })

  it('should update upload methods and upload limit', async () => {
    const user = userEvent.setup()
    render(<ParamConfigContent />)

    await user.click(screen.getByText('appDebug.vision.visionSettings.localUpload'))
    expect(getUpdatedFile().allowed_file_upload_methods).toEqual([TransferMethod.local_file])

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '5' } })
    expect(getUpdatedFile().number_limits).toBe(5)
  })
})
