import type { DocPathWithoutLang } from '@/types/doc-paths'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import { CreateFromDSLModalTab } from '../index'
import { useCreateFromDSLModal } from '../use-create-from-dsl-modal'

const mockPush = vi.fn()
const mockTrackEvent = vi.fn()
const mockHandleCheckPluginDependencies = vi.fn()
const mockImportAppBundle = vi.fn()
const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
const mockGetRedirection = vi.fn()
const mockUseKeyPress = vi.fn()
let mockProviderContext = {
  enableBilling: true,
  plan: {
    usage: { buildApps: 0 },
    total: { buildApps: 5 },
  },
}

const capturedKeyCallbacks = new Map<string | string[], () => void>()

vi.mock('ahooks', () => ({
  useKeyPress: (key: string | string[], callback: () => void) => {
    capturedKeyCallbacks.set(Array.isArray(key) ? key.join('|') : key, callback)
    mockUseKeyPress(key, callback)
  },
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: true,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockProviderContext,
}))

vi.mock('@/service/apps', () => ({
  importAppBundle: (...args: unknown[]) => mockImportAppBundle(...args),
  importDSL: (...args: unknown[]) => mockImportDSL(...args),
  importDSLConfirm: (...args: unknown[]) => mockImportDSLConfirm(...args),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

vi.mock('@/utils/app-redirection', () => ({
  getRedirection: (...args: unknown[]) => mockGetRedirection(...args),
}))

class MockFileReader {
  onload: ((event: { target?: { result?: string } }) => void) | null = null

  readAsText(file: File) {
    this.onload?.({ target: { result: `content:${file.name}` } })
  }
}

const appManagementLocalizedPathMap: Record<string, DocPathWithoutLang> = {
  'zh-Hans': '/use-dify/workspace/app-management',
}

describe('useCreateFromDSLModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedKeyCallbacks.clear()
    vi.stubGlobal('FileReader', MockFileReader)
    mockHandleCheckPluginDependencies.mockResolvedValue(undefined)
    mockProviderContext = {
      enableBilling: true,
      plan: {
        usage: { buildApps: 0 },
        total: { buildApps: 5 },
      },
    }
  })

  it('should initialize with file tab defaults and a docs url', () => {
    const { result } = renderHook(() => useCreateFromDSLModal({
      show: true,
      onClose: vi.fn(),
      activeTab: CreateFromDSLModalTab.FROM_FILE,
      dslUrl: '',
      appManagementLocalizedPathMap,
    }))

    expect(result.current.currentTab).toBe(CreateFromDSLModalTab.FROM_FILE)
    expect(result.current.buttonDisabled).toBe(true)
    expect(result.current.docHref).toContain('/use-dify/workspace/app-management#app-export-and-import')
  })

  it('should read non-zip files and enable creation', async () => {
    const { result } = renderHook(() => useCreateFromDSLModal({
      show: true,
      onClose: vi.fn(),
      activeTab: CreateFromDSLModalTab.FROM_FILE,
      dslUrl: '',
      appManagementLocalizedPathMap,
    }))
    const file = new File(['yaml'], 'demo.yml', { type: 'text/yaml' })

    await act(async () => {
      result.current.handleFile(file)
    })

    expect(result.current.currentFile).toBe(file)
    expect(result.current.buttonDisabled).toBe(false)
  })

  it('should initialize from a dropped file and clear cached content for zip uploads', async () => {
    const droppedFile = new File(['yaml'], 'seed.yml', { type: 'text/yaml' })
    const { result } = renderHook(() => useCreateFromDSLModal({
      show: true,
      onClose: vi.fn(),
      activeTab: CreateFromDSLModalTab.FROM_FILE,
      dslUrl: '',
      droppedFile,
      appManagementLocalizedPathMap,
    }))

    await waitFor(() => {
      expect(result.current.currentFile).toBe(droppedFile)
    })

    const zipFile = new File(['zip'], 'bundle.zip', { type: 'application/zip' })
    mockImportAppBundle.mockResolvedValue({
      id: 'import-zip',
      status: 'completed',
      app_id: 'app-zip',
      app_mode: 'chat',
    })

    await act(async () => {
      result.current.handleFile(zipFile)
    })

    await waitFor(() => {
      expect(result.current.currentFile).toBe(zipFile)
    })

    await act(async () => {
      await result.current.handleCreate()
    })

    expect(mockImportAppBundle).toHaveBeenCalledWith({ file: zipFile })
  })

  it('should import from URL and complete the success flow', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-1',
      status: 'completed',
      app_id: 'app-1',
      app_mode: 'chat',
    })
    const onSuccess = vi.fn()
    const onClose = vi.fn()

    const { result } = renderHook(() => useCreateFromDSLModal({
      show: true,
      onSuccess,
      onClose,
      activeTab: CreateFromDSLModalTab.FROM_URL,
      dslUrl: 'https://example.com/app.yml',
      appManagementLocalizedPathMap,
    }))

    await act(async () => {
      await result.current.handleCreate()
    })

    expect(mockImportDSL).toHaveBeenCalledWith({
      mode: 'yaml-url',
      yaml_url: 'https://example.com/app.yml',
    })
    expect(mockTrackEvent).toHaveBeenCalledWith('create_app_with_dsl', expect.objectContaining({
      creation_method: 'dsl_url',
      has_warnings: false,
    }))
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('app-1')
    expect(mockGetRedirection).toHaveBeenCalledWith(true, { id: 'app-1', mode: 'chat' }, mockPush)
  })

  it('should open the confirm modal when the DSL import is pending', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-2',
      status: 'pending',
      imported_dsl_version: '0.9.0',
      current_dsl_version: '1.0.0',
    })

    const { result } = renderHook(() => useCreateFromDSLModal({
      show: true,
      onClose: vi.fn(),
      activeTab: CreateFromDSLModalTab.FROM_URL,
      dslUrl: 'https://example.com/app.yml',
      appManagementLocalizedPathMap,
    }))

    await act(async () => {
      await result.current.handleCreate()
    })

    await waitFor(() => {
      expect(result.current.showErrorModal).toBe(true)
    })
    expect(result.current.versions).toEqual({
      importedVersion: '0.9.0',
      systemVersion: '1.0.0',
    })
  })

  it('should return early when required input is missing or the import returns no response', async () => {
    const missingFile = renderHook(() => useCreateFromDSLModal({
      show: true,
      onClose: vi.fn(),
      activeTab: CreateFromDSLModalTab.FROM_FILE,
      dslUrl: '',
      appManagementLocalizedPathMap,
    }))

    await act(async () => {
      await missingFile.result.current.handleCreate()
    })

    expect(mockImportDSL).not.toHaveBeenCalled()
    expect(mockImportAppBundle).not.toHaveBeenCalled()

    const missingUrl = renderHook(() => useCreateFromDSLModal({
      show: true,
      onClose: vi.fn(),
      activeTab: CreateFromDSLModalTab.FROM_URL,
      dslUrl: '',
      appManagementLocalizedPathMap,
    }))

    await act(async () => {
      await missingUrl.result.current.handleCreate()
    })

    expect(mockImportDSL).not.toHaveBeenCalled()

    mockImportDSL.mockResolvedValue(undefined)
    const noResponse = renderHook(() => useCreateFromDSLModal({
      show: true,
      onClose: vi.fn(),
      activeTab: CreateFromDSLModalTab.FROM_URL,
      dslUrl: 'https://example.com/app.yml',
      appManagementLocalizedPathMap,
    }))

    await act(async () => {
      await noResponse.result.current.handleCreate()
    })

    expect(mockImportDSL).toHaveBeenCalledWith({
      mode: 'yaml-url',
      yaml_url: 'https://example.com/app.yml',
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should confirm a pending import through importDSLConfirm', async () => {
    mockImportDSLConfirm.mockResolvedValue({
      status: 'completed',
      app_id: 'app-2',
      app_mode: 'workflow',
    })
    const onSuccess = vi.fn()
    const onClose = vi.fn()

    const { result } = renderHook(() => useCreateFromDSLModal({
      show: true,
      onSuccess,
      onClose,
      activeTab: CreateFromDSLModalTab.FROM_URL,
      dslUrl: 'https://example.com/app.yml',
      appManagementLocalizedPathMap,
    }))

    await act(async () => {
      result.current.setShowErrorModal(true)
    })

    await act(async () => {
      // Seed the pending import id by taking the pending path first.
      mockImportDSL.mockResolvedValueOnce({
        id: 'import-3',
        status: 'pending',
        imported_dsl_version: '0.9.0',
        current_dsl_version: '1.0.0',
      })
      await result.current.handleCreate()
    })

    await act(async () => {
      await result.current.handleDSLConfirm()
    })

    expect(mockImportDSLConfirm).toHaveBeenCalledWith({
      import_id: 'import-3',
    })
    expect(onSuccess).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('should guard duplicate submissions and surface failed confirmation flows', async () => {
    let resolveImport: ((value: { id: string, status: string }) => void) | undefined
    mockImportDSL.mockReturnValue(new Promise((resolve) => {
      resolveImport = resolve
    }))

    const { result } = renderHook(() => useCreateFromDSLModal({
      show: true,
      onClose: vi.fn(),
      activeTab: CreateFromDSLModalTab.FROM_URL,
      dslUrl: 'https://example.com/app.yml',
      appManagementLocalizedPathMap,
    }))

    const firstCreate = act(async () => {
      await result.current.handleCreate()
    })

    await act(async () => {
      await result.current.handleCreate()
    })

    expect(mockImportDSL).toHaveBeenCalledTimes(1)

    resolveImport?.({
      id: 'import-guard',
      status: 'failed',
    })
    await firstCreate

    expect(toast.error).toHaveBeenCalledWith('app.newApp.appCreateFailed')
    expect(result.current.isCreating).toBe(false)

    mockImportDSL.mockResolvedValueOnce({
      id: 'import-confirm',
      status: 'pending',
      imported_dsl_version: '0.9.0',
      current_dsl_version: '1.0.0',
    })

    await act(async () => {
      await result.current.handleCreate()
    })

    mockImportDSLConfirm.mockResolvedValueOnce({
      status: 'failed',
    }).mockRejectedValueOnce(new Error('broken'))

    await act(async () => {
      await result.current.handleDSLConfirm()
    })

    expect(toast.error).toHaveBeenCalledWith('app.newApp.appCreateFailed')

    await act(async () => {
      await result.current.handleDSLConfirm()
    })

    expect(toast.error).toHaveBeenCalledWith('app.newApp.appCreateFailed')
  })

  it('should trigger create on the keyboard shortcut and close on escape', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-4',
      status: 'failed',
    })
    const onClose = vi.fn()

    renderHook(() => useCreateFromDSLModal({
      show: true,
      onClose,
      activeTab: CreateFromDSLModalTab.FROM_URL,
      dslUrl: 'https://example.com/app.yml',
      appManagementLocalizedPathMap,
    }))

    await act(async () => {
      capturedKeyCallbacks.get('meta.enter|ctrl.enter')?.()
    })

    expect(mockImportDSL).toHaveBeenCalledTimes(1)

    act(() => {
      capturedKeyCallbacks.get('esc')?.()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should skip keyboard creation when hidden or when the workspace is out of app quota', async () => {
    mockProviderContext = {
      enableBilling: true,
      plan: {
        usage: { buildApps: 5 },
        total: { buildApps: 5 },
      },
    }

    renderHook(() => useCreateFromDSLModal({
      show: false,
      onClose: vi.fn(),
      activeTab: CreateFromDSLModalTab.FROM_URL,
      dslUrl: 'https://example.com/app.yml',
      appManagementLocalizedPathMap,
    }))

    await act(async () => {
      capturedKeyCallbacks.get('meta.enter|ctrl.enter')?.()
    })

    expect(mockImportDSL).not.toHaveBeenCalled()
  })

  it('should expose manual confirm success and ignore confirm requests without an import id', async () => {
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    const { result } = renderHook(() => useCreateFromDSLModal({
      show: true,
      onSuccess,
      onClose,
      activeTab: CreateFromDSLModalTab.FROM_URL,
      dslUrl: 'https://example.com/app.yml',
      appManagementLocalizedPathMap,
    }))

    await act(async () => {
      await result.current.handleDSLConfirm()
    })

    expect(mockImportDSLConfirm).not.toHaveBeenCalled()

    act(() => {
      result.current.handleConfirmSuccess()
    })

    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
