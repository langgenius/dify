import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import useHideLogic from '../use-hide-logic'

const mockFoldAnimInto = vi.fn()
const mockClearCountDown = vi.fn()
const mockCountDownFoldIntoAnim = vi.fn()

vi.mock('../use-fold-anim-into', () => ({
  default: () => ({
    modalClassName: 'test-modal-class',
    foldIntoAnim: mockFoldAnimInto,
    clearCountDown: mockClearCountDown,
    countDownFoldIntoAnim: mockCountDownFoldIntoAnim,
  }),
}))

describe('useHideLogic', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return initial state with modalClassName', () => {
    const { result } = renderHook(() => useHideLogic(mockOnClose))

    expect(result.current.modalClassName).toBe('test-modal-class')
  })

  it('should call onClose directly when not installing', () => {
    const { result } = renderHook(() => useHideLogic(mockOnClose))

    act(() => {
      result.current.foldAnimInto()
    })

    expect(mockOnClose).toHaveBeenCalled()
    expect(mockFoldAnimInto).not.toHaveBeenCalled()
  })

  it('should call doFoldAnimInto when installing', () => {
    const { result } = renderHook(() => useHideLogic(mockOnClose))

    act(() => {
      result.current.handleStartToInstall()
    })

    act(() => {
      result.current.foldAnimInto()
    })

    expect(mockFoldAnimInto).toHaveBeenCalled()
    expect(mockOnClose).not.toHaveBeenCalled()
  })

  it('should set installing and start countdown on handleStartToInstall', () => {
    const { result } = renderHook(() => useHideLogic(mockOnClose))

    act(() => {
      result.current.handleStartToInstall()
    })

    expect(mockCountDownFoldIntoAnim).toHaveBeenCalled()
  })

  it('should clear countdown when setIsInstalling to false', () => {
    const { result } = renderHook(() => useHideLogic(mockOnClose))

    act(() => {
      result.current.setIsInstalling(false)
    })

    expect(mockClearCountDown).toHaveBeenCalled()
  })
})
