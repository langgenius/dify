import type { ChangeEvent } from 'react'
import type { AppContextValue } from '@/context/app-context'
import type { SystemFeatures } from '@/types/feature'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { getImageUploadErrorMessage, imageUpload } from '@/app/components/base/image-uploader/utils'
import { defaultPlan } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import {
  initialLangGeniusVersionInfo,
  initialWorkspaceInfo,
  useAppContext,
  userProfilePlaceholder,
} from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useProviderContext } from '@/context/provider-context'
import { updateCurrentWorkspace } from '@/service/common'
import { defaultSystemFeatures } from '@/types/feature'
import useWebAppBrand from '../use-web-app-brand'

const { mockNotify, mockToast } = vi.hoisted(() => {
  const mockNotify = vi.fn()
  const mockToast = Object.assign(mockNotify, {
    success: vi.fn((message, options) => mockNotify({ type: 'success', message, ...options })),
    error: vi.fn((message, options) => mockNotify({ type: 'error', message, ...options })),
    warning: vi.fn((message, options) => mockNotify({ type: 'warning', message, ...options })),
    info: vi.fn((message, options) => mockNotify({ type: 'info', message, ...options })),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockNotify, mockToast }
})

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: mockToast,
}))
vi.mock('@/service/common', () => ({
  updateCurrentWorkspace: vi.fn(),
}))
vi.mock('@/context/app-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/app-context')>()
  return {
    ...actual,
    useAppContext: vi.fn(),
  }
})
vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))
vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))
vi.mock('@/app/components/base/image-uploader/utils', () => ({
  imageUpload: vi.fn(),
  getImageUploadErrorMessage: vi.fn(),
}))

const mockUpdateCurrentWorkspace = vi.mocked(updateCurrentWorkspace)
const mockUseAppContext = vi.mocked(useAppContext)
const mockUseProviderContext = vi.mocked(useProviderContext)
const mockUseGlobalPublicStore = vi.mocked(useGlobalPublicStore)
const mockImageUpload = vi.mocked(imageUpload)
const mockGetImageUploadErrorMessage = vi.mocked(getImageUploadErrorMessage)

const createProviderContext = ({
  enableBilling = false,
  planType = Plan.professional,
}: {
  enableBilling?: boolean
  planType?: Plan
} = {}) => {
  return createMockProviderContextValue({
    enableBilling,
    plan: {
      ...defaultPlan,
      type: planType,
    },
  })
}

const createSystemFeatures = (brandingOverrides: Partial<SystemFeatures['branding']> = {}): SystemFeatures => ({
  ...defaultSystemFeatures,
  branding: {
    ...defaultSystemFeatures.branding,
    enabled: true,
    workspace_logo: 'https://example.com/workspace-logo.png',
    ...brandingOverrides,
  },
})

const createAppContextValue = (overrides: Partial<AppContextValue> = {}): AppContextValue => {
  const { currentWorkspace: currentWorkspaceOverride, ...restOverrides } = overrides
  const workspaceOverrides: Partial<AppContextValue['currentWorkspace']> = currentWorkspaceOverride ?? {}
  const currentWorkspace = {
    ...initialWorkspaceInfo,
    ...workspaceOverrides,
    custom_config: {
      replace_webapp_logo: 'https://example.com/replace.png',
      remove_webapp_brand: false,
      ...workspaceOverrides.custom_config,
    },
  }

  return {
    userProfile: userProfilePlaceholder,
    mutateUserProfile: vi.fn(),
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceOwner: false,
    isCurrentWorkspaceEditor: false,
    isCurrentWorkspaceDatasetOperator: false,
    mutateCurrentWorkspace: vi.fn(),
    langGeniusVersionInfo: initialLangGeniusVersionInfo,
    useSelector: vi.fn() as unknown as AppContextValue['useSelector'],
    isLoadingCurrentWorkspace: false,
    isValidatingCurrentWorkspace: false,
    ...restOverrides,
    currentWorkspace,
  }
}

describe('useWebAppBrand', () => {
  let appContextValue: AppContextValue
  let systemFeatures: SystemFeatures

  beforeEach(() => {
    vi.clearAllMocks()

    appContextValue = createAppContextValue()
    systemFeatures = createSystemFeatures()

    mockUpdateCurrentWorkspace.mockResolvedValue(appContextValue.currentWorkspace)
    mockUseAppContext.mockImplementation(() => appContextValue)
    mockUseProviderContext.mockReturnValue(createProviderContext())
    mockUseGlobalPublicStore.mockImplementation(selector => selector({
      systemFeatures,
      setSystemFeatures: vi.fn(),
    }))
    mockGetImageUploadErrorMessage.mockReturnValue('upload error')
  })

  // Derived state from context and store inputs.
  describe('derived state', () => {
    it('should expose workspace branding and upload availability by default', () => {
      const { result } = renderHook(() => useWebAppBrand())

      expect(result.current.webappLogo).toBe('https://example.com/replace.png')
      expect(result.current.workspaceLogo).toBe('https://example.com/workspace-logo.png')
      expect(result.current.uploadDisabled).toBe(false)
      expect(result.current.uploading).toBe(false)
    })

    it('should disable uploads in sandbox workspaces and when branding is removed', () => {
      mockUseProviderContext.mockReturnValue(createProviderContext({
        enableBilling: true,
        planType: Plan.sandbox,
      }))
      appContextValue = createAppContextValue({
        currentWorkspace: {
          ...initialWorkspaceInfo,
          custom_config: {
            replace_webapp_logo: 'https://example.com/replace.png',
            remove_webapp_brand: true,
          },
        },
      })

      const { result } = renderHook(() => useWebAppBrand())

      expect(result.current.isSandbox).toBe(true)
      expect(result.current.webappBrandRemoved).toBe(true)
      expect(result.current.uploadDisabled).toBe(true)
    })

    it('should fall back to an empty workspace logo when branding is disabled', () => {
      systemFeatures = createSystemFeatures({
        enabled: false,
        workspace_logo: '',
      })

      const { result } = renderHook(() => useWebAppBrand())

      expect(result.current.workspaceLogo).toBe('')
    })

    it('should fall back to an empty custom logo when custom config is missing', () => {
      appContextValue = {
        ...createAppContextValue(),
        currentWorkspace: {
          ...initialWorkspaceInfo,
        },
      }

      const { result } = renderHook(() => useWebAppBrand())

      expect(result.current.webappLogo).toBe('')
    })
  })

  // State transitions driven by user actions.
  describe('actions', () => {
    it('should ignore empty file selections', () => {
      const { result } = renderHook(() => useWebAppBrand())

      act(() => {
        result.current.handleChange({
          target: { files: [] },
        } as unknown as ChangeEvent<HTMLInputElement>)
      })

      expect(mockImageUpload).not.toHaveBeenCalled()
    })

    it('should reject oversized files before upload starts', () => {
      const { result } = renderHook(() => useWebAppBrand())
      const oversizedFile = new File(['logo'], 'logo.png', { type: 'image/png' })

      Object.defineProperty(oversizedFile, 'size', {
        configurable: true,
        value: 5 * 1024 * 1024 + 1,
      })

      act(() => {
        result.current.handleChange({
          target: { files: [oversizedFile] },
        } as unknown as ChangeEvent<HTMLInputElement>)
      })

      expect(mockImageUpload).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'common.imageUploader.uploadFromComputerLimit:{"size":5}',
      })
    })

    it('should update upload state after a successful file upload', () => {
      mockImageUpload.mockImplementation(({ onProgressCallback, onSuccessCallback }) => {
        onProgressCallback(100)
        onSuccessCallback({ id: 'new-logo' })
      })

      const { result } = renderHook(() => useWebAppBrand())

      act(() => {
        result.current.handleChange({
          target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
        } as unknown as ChangeEvent<HTMLInputElement>)
      })

      expect(result.current.fileId).toBe('new-logo')
      expect(result.current.uploadProgress).toBe(100)
      expect(result.current.uploading).toBe(false)
    })

    it('should expose the uploading state while progress is incomplete', () => {
      mockImageUpload.mockImplementation(({ onProgressCallback }) => {
        onProgressCallback(50)
      })

      const { result } = renderHook(() => useWebAppBrand())

      act(() => {
        result.current.handleChange({
          target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
        } as unknown as ChangeEvent<HTMLInputElement>)
      })

      expect(result.current.uploadProgress).toBe(50)
      expect(result.current.uploading).toBe(true)
    })

    it('should surface upload errors and set the failure state', () => {
      mockImageUpload.mockImplementation(({ onErrorCallback }) => {
        onErrorCallback({ response: { code: 'forbidden' } })
      })

      const { result } = renderHook(() => useWebAppBrand())

      act(() => {
        result.current.handleChange({
          target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
        } as unknown as ChangeEvent<HTMLInputElement>)
      })

      expect(mockGetImageUploadErrorMessage).toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'upload error',
      })
      expect(result.current.uploadProgress).toBe(-1)
    })

    it('should persist the selected logo and reset transient state on apply', async () => {
      const mutateCurrentWorkspace = vi.fn()
      appContextValue = createAppContextValue({
        mutateCurrentWorkspace,
      })
      mockImageUpload.mockImplementation(({ onSuccessCallback }) => {
        onSuccessCallback({ id: 'new-logo' })
      })

      const { result } = renderHook(() => useWebAppBrand())

      act(() => {
        result.current.handleChange({
          target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
        } as unknown as ChangeEvent<HTMLInputElement>)
      })

      const previousImgKey = result.current.imgKey
      const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(previousImgKey + 1)

      await act(async () => {
        await result.current.handleApply()
      })

      expect(mockUpdateCurrentWorkspace).toHaveBeenCalledWith({
        url: '/workspaces/custom-config',
        body: {
          remove_webapp_brand: false,
          replace_webapp_logo: 'new-logo',
        },
      })
      expect(mutateCurrentWorkspace).toHaveBeenCalledTimes(1)
      expect(result.current.fileId).toBe('')
      expect(result.current.imgKey).toBe(previousImgKey + 1)
      dateNowSpy.mockRestore()
    })

    it('should restore the default branding configuration', async () => {
      const mutateCurrentWorkspace = vi.fn()
      appContextValue = createAppContextValue({
        mutateCurrentWorkspace,
      })

      const { result } = renderHook(() => useWebAppBrand())

      await act(async () => {
        await result.current.handleRestore()
      })

      expect(mockUpdateCurrentWorkspace).toHaveBeenCalledWith({
        url: '/workspaces/custom-config',
        body: {
          remove_webapp_brand: false,
          replace_webapp_logo: '',
        },
      })
      expect(mutateCurrentWorkspace).toHaveBeenCalledTimes(1)
    })

    it('should persist brand removal changes', async () => {
      const mutateCurrentWorkspace = vi.fn()
      appContextValue = createAppContextValue({
        mutateCurrentWorkspace,
      })

      const { result } = renderHook(() => useWebAppBrand())

      await act(async () => {
        await result.current.handleSwitch(true)
      })

      expect(mockUpdateCurrentWorkspace).toHaveBeenCalledWith({
        url: '/workspaces/custom-config',
        body: {
          remove_webapp_brand: true,
        },
      })
      expect(mutateCurrentWorkspace).toHaveBeenCalledTimes(1)
    })

    it('should clear temporary upload state on cancel', () => {
      mockImageUpload.mockImplementation(({ onSuccessCallback }) => {
        onSuccessCallback({ id: 'new-logo' })
      })

      const { result } = renderHook(() => useWebAppBrand())

      act(() => {
        result.current.handleChange({
          target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
        } as unknown as ChangeEvent<HTMLInputElement>)
      })

      act(() => {
        result.current.handleCancel()
      })

      expect(result.current.fileId).toBe('')
      expect(result.current.uploadProgress).toBe(0)
    })
  })
})
