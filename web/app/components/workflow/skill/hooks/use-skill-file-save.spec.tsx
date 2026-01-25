import type { SaveFileOptions, SaveResult } from './use-skill-save-manager'
import { act, renderHook, waitFor } from '@testing-library/react'
import Toast from '@/app/components/base/toast'
import { useSkillFileSave } from './use-skill-file-save'

const { mockSaveFile, mockToastNotify } = vi.hoisted(() => ({
  mockSaveFile: vi.fn<(fileId: string, options?: SaveFileOptions) => Promise<SaveResult>>(),
  mockToastNotify: vi.fn(),
}))

vi.mock('./use-skill-save-manager', () => ({
  useSkillSaveManager: () => ({
    saveFile: mockSaveFile,
  }),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: mockToastNotify,
  },
}))

const createParams = (overrides: Partial<Parameters<typeof useSkillFileSave>[0]> = {}) => ({
  appId: 'app-1',
  activeTabId: 'file-1' as string | null,
  isEditable: true,
  originalContent: 'original content',
  currentMetadata: { version: 1 } as Record<string, unknown>,
  t: vi.fn(() => 'saved-message') as unknown as Parameters<typeof useSkillFileSave>[0]['t'],
  ...overrides,
})

// Scenario: save behavior and shortcut handling for skill file saves.
describe('useSkillFileSave', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveFile.mockResolvedValue({ saved: false })
  })

  // Scenario: guard clauses prevent invalid saves.
  describe('Guards', () => {
    it('should return early when active tab id is missing', async () => {
      // Arrange
      const params = createParams({ activeTabId: null })
      const { result } = renderHook(() => useSkillFileSave(params))

      // Act
      await act(async () => {
        await result.current()
      })

      // Assert
      expect(mockSaveFile).not.toHaveBeenCalled()
      expect(Toast.notify).not.toHaveBeenCalled()
    })

    it('should return early when app id is empty', async () => {
      // Arrange
      const params = createParams({ appId: '' })
      const { result } = renderHook(() => useSkillFileSave(params))

      // Act
      await act(async () => {
        await result.current()
      })

      // Assert
      expect(mockSaveFile).not.toHaveBeenCalled()
      expect(Toast.notify).not.toHaveBeenCalled()
    })

    it('should return early when not editable', async () => {
      // Arrange
      const params = createParams({ isEditable: false })
      const { result } = renderHook(() => useSkillFileSave(params))

      // Act
      await act(async () => {
        await result.current()
      })

      // Assert
      expect(mockSaveFile).not.toHaveBeenCalled()
      expect(Toast.notify).not.toHaveBeenCalled()
    })
  })

  // Scenario: save results surface as toast notifications.
  describe('Save Results', () => {
    it('should call saveFile with fallback data when valid', async () => {
      // Arrange
      const params = createParams({
        originalContent: 'fallback content',
        currentMetadata: { tag: 'v1' },
      })
      const { result } = renderHook(() => useSkillFileSave(params))

      // Act
      await act(async () => {
        await result.current()
      })

      // Assert
      expect(mockSaveFile).toHaveBeenCalledWith('file-1', {
        fallbackContent: 'fallback content',
        fallbackMetadata: { tag: 'v1' },
      })
      expect(Toast.notify).not.toHaveBeenCalled()
    })

    it('should show error toast when save fails', async () => {
      // Arrange
      const params = createParams()
      mockSaveFile.mockResolvedValueOnce({ saved: false, error: new Error('boom') })
      const { result } = renderHook(() => useSkillFileSave(params))

      // Act
      await act(async () => {
        await result.current()
      })

      // Assert
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Error: boom',
      })
      expect(params.t).not.toHaveBeenCalled()
    })

    it('should show success toast when save succeeds', async () => {
      // Arrange
      const params = createParams()
      mockSaveFile.mockResolvedValueOnce({ saved: true })
      const { result } = renderHook(() => useSkillFileSave(params))

      // Act
      await act(async () => {
        await result.current()
      })

      // Assert
      expect(params.t).toHaveBeenCalledWith('api.saved', { ns: 'common' })
      expect(Toast.notify).toHaveBeenCalledWith({
        type: 'success',
        message: 'saved-message',
      })
    })
  })

  // Scenario: Ctrl/Cmd+S triggers save and suppresses default behavior.
  describe('Keyboard Shortcut', () => {
    it('should trigger save on Ctrl+S', async () => {
      // Arrange
      const params = createParams()
      renderHook(() => useSkillFileSave(params))
      const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
      const preventDefault = vi.fn()
      Object.defineProperty(event, 'preventDefault', { value: preventDefault })

      // Act
      act(() => {
        window.dispatchEvent(event)
      })

      // Assert
      await waitFor(() => {
        expect(mockSaveFile).toHaveBeenCalled()
      })
      expect(preventDefault).toHaveBeenCalled()
    })

    it('should trigger save on Cmd+S', async () => {
      // Arrange
      const params = createParams()
      renderHook(() => useSkillFileSave(params))
      const event = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true })
      const preventDefault = vi.fn()
      Object.defineProperty(event, 'preventDefault', { value: preventDefault })

      // Act
      act(() => {
        window.dispatchEvent(event)
      })

      // Assert
      await waitFor(() => {
        expect(mockSaveFile).toHaveBeenCalled()
      })
      expect(preventDefault).toHaveBeenCalled()
    })

    it('should not trigger save when key is not s', async () => {
      // Arrange
      const params = createParams()
      renderHook(() => useSkillFileSave(params))
      const event = new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, cancelable: true })

      // Act
      act(() => {
        window.dispatchEvent(event)
      })

      // Assert
      await waitFor(() => {
        expect(mockSaveFile).not.toHaveBeenCalled()
      })
    })
  })
})
