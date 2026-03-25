import type { Mock } from 'vitest'
import type { FeatureStoreState } from '@/app/components/base/features/store'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import ConfigDocument from './config-document'

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

const renderConfigDocument = (options: SetupOptions = {}) => {
  const {
    isVisible = true,
    allowedTypes = [],
  } = options
  setupFeatureStore(allowedTypes)
  mockUseContext.mockReturnValue({
    isShowDocumentConfig: isVisible,
  })
  const user = userEvent.setup()
  render(<ConfigDocument />)
  return {
    user,
    setFeatures: mockSetFeatures,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ConfigDocument', () => {
  it('should not render when the document configuration is hidden', () => {
    renderConfigDocument({ isVisible: false })

    expect(screen.queryByText('appDebug.feature.documentUpload.title')).not.toBeInTheDocument()
  })

  it('should show document toggle badge when configuration is visible', () => {
    renderConfigDocument({ allowedTypes: [SupportUploadFileTypes.document] })

    expect(screen.getByText('appDebug.feature.documentUpload.title')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('should add document type to allowed list when toggled on', async () => {
    const { user, setFeatures } = renderConfigDocument({ allowedTypes: [SupportUploadFileTypes.audio] })
    const toggle = screen.getByRole('switch')

    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)

    expect(setFeatures).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({
        allowed_file_types: [SupportUploadFileTypes.audio, SupportUploadFileTypes.document],
        enabled: true,
      }),
    }))
  })

  it('should remove document type but keep file feature enabled when other types remain', async () => {
    const { user, setFeatures } = renderConfigDocument({
      allowedTypes: [SupportUploadFileTypes.document, SupportUploadFileTypes.audio],
    })
    const toggle = screen.getByRole('switch')

    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(toggle)

    expect(setFeatures).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({
        allowed_file_types: [SupportUploadFileTypes.audio],
        enabled: true,
      }),
    }))
  })
})
