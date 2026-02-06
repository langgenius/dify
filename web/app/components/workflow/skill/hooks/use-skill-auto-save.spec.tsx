import { act, renderHook } from '@testing-library/react'
import { useSkillAutoSave } from './use-skill-auto-save'

const { mockSaveAllDirty } = vi.hoisted(() => ({
  mockSaveAllDirty: vi.fn(),
}))

vi.mock('./skill-save-context', () => ({
  useSkillSaveManager: () => ({
    saveAllDirty: mockSaveAllDirty,
  }),
}))

const setVisibilityState = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  })
}

describe('useSkillAutoSave', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setVisibilityState('visible')
  })

  it('should save all dirty files on unmount', () => {
    const { unmount } = renderHook(() => useSkillAutoSave())

    unmount()

    expect(mockSaveAllDirty).toHaveBeenCalledTimes(1)
  })

  it('should save all dirty files when document becomes hidden', () => {
    renderHook(() => useSkillAutoSave())

    setVisibilityState('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockSaveAllDirty).toHaveBeenCalledTimes(1)
  })

  it('should not save when document becomes visible', () => {
    renderHook(() => useSkillAutoSave())

    setVisibilityState('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockSaveAllDirty).not.toHaveBeenCalled()
  })

  it('should save all dirty files before unload', () => {
    renderHook(() => useSkillAutoSave())

    act(() => {
      window.dispatchEvent(new Event('beforeunload'))
    })

    expect(mockSaveAllDirty).toHaveBeenCalledTimes(1)
  })

  it('should remove listeners after unmount', () => {
    const { unmount } = renderHook(() => useSkillAutoSave())

    unmount()

    setVisibilityState('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('beforeunload'))
    })

    expect(mockSaveAllDirty).toHaveBeenCalledTimes(1)
  })
})
