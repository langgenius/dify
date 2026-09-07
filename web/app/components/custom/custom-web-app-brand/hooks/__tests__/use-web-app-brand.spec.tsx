import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { ChangeEvent } from 'react'
import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { getImageUploadErrorMessage, imageUpload } from '@/app/components/base/image-uploader/utils'
import { defaultPlan } from '@/app/components/billing/config'
import { useProviderContext } from '@/context/provider-context'
import { createConsoleQueryClient, renderHookWithConsoleQuery } from '@/test/console/query-data'
import useWebAppBrand from '../use-web-app-brand'

let currentBrandingOverrides: Partial<GetSystemFeaturesResponse['branding']> = {}
let customConfig = {
  replace_webapp_logo: 'https://example.com/replace.png',
  remove_webapp_brand: false,
}
let seedCustomConfig = true
let customConfigQueryPending = false
let customConfigQueryError: Error | undefined
const renderHook = <Result, Props = void>(callback: (props: Props) => Result) => {
  const queryClient = createConsoleQueryClient()
  if (seedCustomConfig) queryClient.setQueryData(['custom-config'], customConfig)

  return renderHookWithConsoleQuery(callback, {
    systemFeatures: {
      branding: {
        enabled: true,
        workspace_logo: 'https://example.com/workspace-logo.png',
        ...currentBrandingOverrides,
      },
    },
    queryClient,
  })
}

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
const consoleStateRef = vi.hoisted(() => ({
  value: undefined as ConsoleStateFixture | undefined,
}))
const mockUpdateCustomConfig = vi.hoisted(() => vi.fn())

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: mockToast,
}))
vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  const consoleQuery = new Proxy(actual.consoleQuery, {
    get(target, prop, receiver) {
      if (prop === 'workspaces') {
        return new Proxy(target.workspaces, {
          get(workspacesTarget, workspaceProp, workspaceReceiver) {
            if (workspaceProp === 'customConfig') {
              return {
                get: {
                  key: () => ['custom-config'],
                  queryOptions: () => ({
                    queryKey: ['custom-config'],
                    queryFn: async () => {
                      if (customConfigQueryPending) return new Promise<never>(() => {})
                      if (customConfigQueryError)
                        return Promise.reject(new Error(customConfigQueryError.message))
                      return customConfig
                    },
                  }),
                },
                post: {
                  mutationOptions: () => ({
                    mutationFn: (variables: unknown) => mockUpdateCustomConfig(variables),
                  }),
                },
              }
            }

            return Reflect.get(workspacesTarget, workspaceProp, workspaceReceiver)
          },
        })
      }

      return Reflect.get(target, prop, receiver)
    },
  })

  return {
    ...actual,
    consoleQuery,
  }
})
vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    ...consoleStateRef.value,
    refreshCurrentWorkspace: consoleStateRef.value?.refreshCurrentWorkspace,
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    ...consoleStateRef.value,
    refreshCurrentWorkspace: consoleStateRef.value?.refreshCurrentWorkspace,
  }))
})
vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))
vi.mock('@/app/components/base/image-uploader/utils', () => ({
  imageUpload: vi.fn(),
  getImageUploadErrorMessage: vi.fn(),
}))

const mockUseProviderContext = vi.mocked(useProviderContext)
const mockImageUpload = vi.mocked(imageUpload)
const mockGetImageUploadErrorMessage = vi.mocked(getImageUploadErrorMessage)

const testUserProfile = {
  id: '',
  name: '',
  email: '',
  avatar: '',
  avatar_url: '',
  is_password_set: false,
}

const createProviderContext = ({
  enableBilling = false,
  planType = 'professional',
}: {
  enableBilling?: boolean
  planType?: CloudPlan
} = {}) => {
  return createMockProviderContextValue({
    enableBilling,
    plan: {
      ...defaultPlan,
      type: planType,
    },
  })
}

const createConsoleState = (overrides: Partial<ConsoleStateFixture> = {}): ConsoleStateFixture => {
  return {
    userProfile: testUserProfile,
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceOwner: false,
    isCurrentWorkspaceEditor: false,
    isCurrentWorkspaceDatasetOperator: false,
    workspacePermissionKeys: ['customization.manage'],
    refreshCurrentWorkspace: vi.fn(),
    isLoadingCurrentWorkspace: false,
    ...overrides,
  }
}

describe('useWebAppBrand', () => {
  const setConsoleState = (nextValue: ConsoleStateFixture) => {
    consoleStateRef.value = nextValue
  }

  beforeEach(() => {
    vi.clearAllMocks()

    setConsoleState(createConsoleState())
    currentBrandingOverrides = {}

    customConfig = {
      replace_webapp_logo: 'https://example.com/replace.png',
      remove_webapp_brand: false,
    }
    seedCustomConfig = true
    customConfigQueryPending = false
    customConfigQueryError = undefined
    mockUpdateCustomConfig.mockResolvedValue(customConfig)
    mockUseProviderContext.mockReturnValue(createProviderContext())
    mockGetImageUploadErrorMessage.mockReturnValue('upload error')
  })

  // Derived state from context and store inputs.
  describe('derived state', () => {
    it('should expose workspace branding and upload availability by default', () => {
      const { result } = renderHook(() => useWebAppBrand())

      expect(result.current.webappLogo).toBe('https://example.com/replace.png')
      expect(result.current.workspaceLogo).toBe('https://example.com/workspace-logo.png')
      expect(result.current.canManageCustomBrand).toBe(true)
      expect(result.current.uploadDisabled).toBe(false)
      expect(result.current.uploading).toBe(false)
    })

    it('should disable uploads when customization management permission is missing', () => {
      setConsoleState(
        createConsoleState({
          workspacePermissionKeys: [],
          isCurrentWorkspaceManager: true,
        }),
      )

      const { result } = renderHook(() => useWebAppBrand())

      expect(result.current.canManageCustomBrand).toBe(false)
      expect(result.current.uploadDisabled).toBe(true)
    })

    it('should allow uploads for non-manager users with customization management permission', () => {
      setConsoleState(
        createConsoleState({
          workspacePermissionKeys: ['customization.manage'],
          isCurrentWorkspaceManager: false,
        }),
      )

      const { result } = renderHook(() => useWebAppBrand())

      expect(result.current.canManageCustomBrand).toBe(true)
      expect(result.current.uploadDisabled).toBe(false)
    })

    it('should disable uploads in sandbox workspaces and when branding is removed', () => {
      mockUseProviderContext.mockReturnValue(
        createProviderContext({
          enableBilling: true,
          planType: 'sandbox',
        }),
      )
      customConfig = { ...customConfig, remove_webapp_brand: true }

      const { result } = renderHook(() => useWebAppBrand())

      expect(result.current.isSandbox).toBe(true)
      expect(result.current.webappBrandRemoved).toBe(true)
      expect(result.current.uploadDisabled).toBe(true)
    })

    it('should fall back to an empty workspace logo when branding is disabled', () => {
      currentBrandingOverrides = { enabled: false, workspace_logo: '' }

      const { result } = renderHook(() => useWebAppBrand())

      expect(result.current.workspaceLogo).toBe('')
    })

    it('should fall back to an empty custom logo when the custom config has no logo', () => {
      customConfig = { replace_webapp_logo: '', remove_webapp_brand: false }

      const { result } = renderHook(() => useWebAppBrand())

      expect(result.current.webappLogo).toBe('')
    })

    it('should disable brand edits while the custom config is loading', () => {
      seedCustomConfig = false
      customConfigQueryPending = true

      const { result } = renderHook(() => useWebAppBrand())

      expect(result.current.isCustomConfigUnavailable).toBe(true)
      expect(result.current.uploadDisabled).toBe(true)
    })

    it('should disable brand edits when the custom config request fails', async () => {
      seedCustomConfig = false
      customConfigQueryError = new Error('custom config unavailable')

      const { result } = renderHook(() => useWebAppBrand())

      await waitFor(() => {
        expect(result.current.isCustomConfigUnavailable).toBe(true)
      })
      expect(result.current.uploadDisabled).toBe(true)
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

      expect(mockUpdateCustomConfig).toHaveBeenCalledWith({
        body: {
          remove_webapp_brand: false,
          replace_webapp_logo: 'new-logo',
        },
      })
      expect(result.current.fileId).toBe('')
      expect(result.current.imgKey).toBe(previousImgKey + 1)
      dateNowSpy.mockRestore()
    })

    it('should restore the default branding configuration', async () => {
      const { result } = renderHook(() => useWebAppBrand())

      await act(async () => {
        await result.current.handleRestore()
      })

      expect(mockUpdateCustomConfig).toHaveBeenCalledWith({
        body: {
          remove_webapp_brand: false,
          replace_webapp_logo: '',
        },
      })
    })

    it('should persist brand removal changes', async () => {
      const { result } = renderHook(() => useWebAppBrand())

      await act(async () => {
        await result.current.handleSwitch(true)
      })

      expect(mockUpdateCustomConfig).toHaveBeenCalledWith({
        body: {
          remove_webapp_brand: true,
        },
      })
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
