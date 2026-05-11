import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useInputFieldPanel } from '../use-input-field-panel'

const mockSetShowInputFieldPanel = vi.fn()
const mockSetShowInputFieldPreviewPanel = vi.fn()
const mockSetInputFieldEditPanelProps = vi.fn()

let mockShowInputFieldPreviewPanel = false
let mockInputFieldEditPanelProps: unknown = null

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      showInputFieldPreviewPanel: mockShowInputFieldPreviewPanel,
      setShowInputFieldPanel: mockSetShowInputFieldPanel,
      setShowInputFieldPreviewPanel: mockSetShowInputFieldPreviewPanel,
      setInputFieldEditPanelProps: mockSetInputFieldEditPanelProps,
    }),
  }),
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      showInputFieldPreviewPanel: mockShowInputFieldPreviewPanel,
      inputFieldEditPanelProps: mockInputFieldEditPanelProps,
    }
    return selector(state)
  },
}))

describe('useInputFieldPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShowInputFieldPreviewPanel = false
    mockInputFieldEditPanelProps = null
  })

  describe('isPreviewing', () => {
    it('should return false when preview panel is hidden', () => {
      mockShowInputFieldPreviewPanel = false
      const { result } = renderHook(() => useInputFieldPanel())

      expect(result.current.isPreviewing).toBe(false)
    })

    it('should return true when preview panel is shown', () => {
      mockShowInputFieldPreviewPanel = true
      const { result } = renderHook(() => useInputFieldPanel())

      expect(result.current.isPreviewing).toBe(true)
    })
  })

  describe('isEditing', () => {
    it('should return false when no edit panel props', () => {
      mockInputFieldEditPanelProps = null
      const { result } = renderHook(() => useInputFieldPanel())

      expect(result.current.isEditing).toBe(false)
    })

    it('should return true when edit panel props exist', () => {
      mockInputFieldEditPanelProps = { onSubmit: vi.fn(), onClose: vi.fn() }
      const { result } = renderHook(() => useInputFieldPanel())

      expect(result.current.isEditing).toBe(true)
    })
  })

  describe('closeAllInputFieldPanels', () => {
    it('should close all panels and clear edit props', () => {
      const { result } = renderHook(() => useInputFieldPanel())

      act(() => {
        result.current.closeAllInputFieldPanels()
      })

      expect(mockSetShowInputFieldPanel).toHaveBeenCalledWith(false)
      expect(mockSetShowInputFieldPreviewPanel).toHaveBeenCalledWith(false)
      expect(mockSetInputFieldEditPanelProps).toHaveBeenCalledWith(null)
    })
  })

  describe('toggleInputFieldPreviewPanel', () => {
    it('should toggle preview panel from false to true', () => {
      mockShowInputFieldPreviewPanel = false
      const { result } = renderHook(() => useInputFieldPanel())

      act(() => {
        result.current.toggleInputFieldPreviewPanel()
      })

      expect(mockSetShowInputFieldPreviewPanel).toHaveBeenCalledWith(true)
    })

    it('should toggle preview panel from true to false', () => {
      mockShowInputFieldPreviewPanel = true
      const { result } = renderHook(() => useInputFieldPanel())

      act(() => {
        result.current.toggleInputFieldPreviewPanel()
      })

      expect(mockSetShowInputFieldPreviewPanel).toHaveBeenCalledWith(false)
    })
  })

  describe('toggleInputFieldEditPanel', () => {
    it('should set edit panel props when given content', () => {
      const editContent = { onSubmit: vi.fn(), onClose: vi.fn() }
      const { result } = renderHook(() => useInputFieldPanel())

      act(() => {
        result.current.toggleInputFieldEditPanel(editContent)
      })

      expect(mockSetInputFieldEditPanelProps).toHaveBeenCalledWith(editContent)
    })

    it('should clear edit panel props when given null', () => {
      const { result } = renderHook(() => useInputFieldPanel())

      act(() => {
        result.current.toggleInputFieldEditPanel(null)
      })

      expect(mockSetInputFieldEditPanelProps).toHaveBeenCalledWith(null)
    })
  })
})
