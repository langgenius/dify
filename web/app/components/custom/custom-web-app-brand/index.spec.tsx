import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getImageUploadErrorMessage, imageUpload } from '@/app/components/base/image-uploader/utils'
import { useToastContext } from '@/app/components/base/toast'
import { Plan } from '@/app/components/billing/type'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useProviderContext } from '@/context/provider-context'
import { updateCurrentWorkspace } from '@/service/common'
import CustomWebAppBrand from './index'

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: vi.fn(),
}))
vi.mock('@/service/common', () => ({
  updateCurrentWorkspace: vi.fn(),
}))
vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))
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

const mockNotify = vi.fn()
const mockUseToastContext = vi.mocked(useToastContext)
const mockUpdateCurrentWorkspace = vi.mocked(updateCurrentWorkspace)
const mockUseAppContext = vi.mocked(useAppContext)
const mockUseProviderContext = vi.mocked(useProviderContext)
const mockUseGlobalPublicStore = vi.mocked(useGlobalPublicStore)
const mockImageUpload = vi.mocked(imageUpload)
const mockGetImageUploadErrorMessage = vi.mocked(getImageUploadErrorMessage)

const defaultPlanUsage = {
  buildApps: 0,
  teamMembers: 0,
  annotatedResponse: 0,
  documentsUploadQuota: 0,
  apiRateLimit: 0,
  triggerEvents: 0,
  vectorSpace: 0,
}

const renderComponent = () => render(<CustomWebAppBrand />)

describe('CustomWebAppBrand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseToastContext.mockReturnValue({ notify: mockNotify } as any)
    mockUpdateCurrentWorkspace.mockResolvedValue({} as any)
    mockUseAppContext.mockReturnValue({
      currentWorkspace: {
        custom_config: {
          replace_webapp_logo: 'https://example.com/replace.png',
          remove_webapp_brand: false,
        },
      },
      mutateCurrentWorkspace: vi.fn(),
      isCurrentWorkspaceManager: true,
    } as any)
    mockUseProviderContext.mockReturnValue({
      plan: {
        type: Plan.professional,
        usage: defaultPlanUsage,
        total: defaultPlanUsage,
        reset: {},
      },
      enableBilling: false,
    } as any)
    const systemFeaturesState = {
      branding: {
        enabled: true,
        workspace_logo: 'https://example.com/workspace-logo.png',
      },
    }
    mockUseGlobalPublicStore.mockImplementation(selector => selector ? selector({ systemFeatures: systemFeaturesState } as any) : { systemFeatures: systemFeaturesState })
    mockGetImageUploadErrorMessage.mockReturnValue('upload error')
  })

  it('disables upload controls when the user cannot manage the workspace', () => {
    mockUseAppContext.mockReturnValue({
      currentWorkspace: {
        custom_config: {
          replace_webapp_logo: '',
          remove_webapp_brand: false,
        },
      },
      mutateCurrentWorkspace: vi.fn(),
      isCurrentWorkspaceManager: false,
    } as any)

    const { container } = renderComponent()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeDisabled()
  })

  it('toggles remove brand switch and calls the backend + mutate', async () => {
    const mutateMock = vi.fn()
    mockUseAppContext.mockReturnValue({
      currentWorkspace: {
        custom_config: {
          replace_webapp_logo: '',
          remove_webapp_brand: false,
        },
      },
      mutateCurrentWorkspace: mutateMock,
      isCurrentWorkspaceManager: true,
    } as any)

    renderComponent()
    const switchInput = screen.getByRole('switch')
    fireEvent.click(switchInput)

    await waitFor(() => expect(mockUpdateCurrentWorkspace).toHaveBeenCalledWith({
      url: '/workspaces/custom-config',
      body: { remove_webapp_brand: true },
    }))
    await waitFor(() => expect(mutateMock).toHaveBeenCalled())
  })

  it('shows cancel/apply buttons after successful upload and cancels properly', async () => {
    mockImageUpload.mockImplementation(({ onProgressCallback, onSuccessCallback }) => {
      onProgressCallback(50)
      onSuccessCallback({ id: 'new-logo' })
    })

    const { container } = renderComponent()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const testFile = new File(['content'], 'logo.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [testFile] } })

    await waitFor(() => expect(mockImageUpload).toHaveBeenCalled())
    await waitFor(() => screen.getByRole('button', { name: 'custom.apply' }))

    const cancelButton = screen.getByRole('button', { name: 'common.operation.cancel' })
    fireEvent.click(cancelButton)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'custom.apply' })).toBeNull())
  })
})
