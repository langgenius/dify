import { act, renderHook } from '@testing-library/react'
import { useTextAreaHeight } from '../hooks'

describe('useTextAreaHeight', () => {
  // Mock getBoundingClientRect for all ref elements
  const mockGetBoundingClientRect = (
    width: number = 0,
    height: number = 0,
  ) => ({
    width,
    height,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { result } = renderHook(() => useTextAreaHeight())
      expect(result.current).toBeDefined()
    })

    it('should return all required properties', () => {
      const { result } = renderHook(() => useTextAreaHeight())
      expect(result.current).toHaveProperty('wrapperRef')
      expect(result.current).toHaveProperty('textareaRef')
      expect(result.current).toHaveProperty('textValueRef')
      expect(result.current).toHaveProperty('holdSpaceRef')
      expect(result.current).toHaveProperty('handleTextareaResize')
      expect(result.current).toHaveProperty('isMultipleLine')
    })
  })

  describe('Initial State', () => {
    it('should initialize with isMultipleLine as false', () => {
      const { result } = renderHook(() => useTextAreaHeight())
      expect(result.current.isMultipleLine).toBe(false)
    })

    it('should initialize refs as null', () => {
      const { result } = renderHook(() => useTextAreaHeight())
      expect(result.current.wrapperRef.current).toBeNull()
      expect(result.current.textValueRef.current).toBeNull()
      expect(result.current.holdSpaceRef.current).toBeNull()
    })

    it('should initialize textareaRef as undefined', () => {
      const { result } = renderHook(() => useTextAreaHeight())
      expect(result.current.textareaRef.current).toBeUndefined()
    })
  })

  describe('Height Computation Logic (via handleTextareaResize)', () => {
    it('should not update state when any ref is missing', () => {
      const { result } = renderHook(() => useTextAreaHeight())

      act(() => {
        result.current.handleTextareaResize()
      })

      expect(result.current.isMultipleLine).toBe(false)
    })

    it('should set isMultipleLine to true when textarea height exceeds 32px', () => {
      const { result } = renderHook(() => useTextAreaHeight())

      // Set up refs with mock elements
      const wrapperElement = document.createElement('div')
      const textareaElement = document.createElement('textarea')
      const textValueElement = document.createElement('div')
      const holdSpaceElement = document.createElement('div')

      vi.spyOn(wrapperElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(300, 0),
      )
      vi.spyOn(textareaElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(300, 64), // height > 32
      )
      vi.spyOn(textValueElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(100, 0),
      )
      vi.spyOn(holdSpaceElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(50, 0),
      )

      // Assign elements to refs
      result.current.wrapperRef.current = wrapperElement
      result.current.textareaRef.current = textareaElement
      result.current.textValueRef.current = textValueElement
      result.current.holdSpaceRef.current = holdSpaceElement

      act(() => {
        result.current.handleTextareaResize()
      })

      expect(result.current.isMultipleLine).toBe(true)
    })

    it('should set isMultipleLine to true when combined content width exceeds wrapper width', () => {
      const { result } = renderHook(() => useTextAreaHeight())

      const wrapperElement = document.createElement('div')
      const textareaElement = document.createElement('textarea')
      const textValueElement = document.createElement('div')
      const holdSpaceElement = document.createElement('div')

      vi.spyOn(wrapperElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(200, 0), // wrapperWidth = 200
      )
      vi.spyOn(textareaElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(300, 20), // height <= 32
      )
      vi.spyOn(textValueElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(120, 0), // textValueWidth = 120
      )
      vi.spyOn(holdSpaceElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(100, 0), // holdSpaceWidth = 100, total = 220 > 200
      )

      result.current.wrapperRef.current = wrapperElement
      result.current.textareaRef.current = textareaElement
      result.current.textValueRef.current = textValueElement
      result.current.holdSpaceRef.current = holdSpaceElement

      act(() => {
        result.current.handleTextareaResize()
      })

      expect(result.current.isMultipleLine).toBe(true)
    })

    it('should set isMultipleLine to false when content fits in wrapper', () => {
      const { result } = renderHook(() => useTextAreaHeight())

      const wrapperElement = document.createElement('div')
      const textareaElement = document.createElement('textarea')
      const textValueElement = document.createElement('div')
      const holdSpaceElement = document.createElement('div')

      vi.spyOn(wrapperElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(300, 0), // wrapperWidth = 300
      )
      vi.spyOn(textareaElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(300, 20), // height <= 32
      )
      vi.spyOn(textValueElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(100, 0), // textValueWidth = 100
      )
      vi.spyOn(holdSpaceElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(50, 0), // holdSpaceWidth = 50, total = 150 < 300
      )

      result.current.wrapperRef.current = wrapperElement
      result.current.textareaRef.current = textareaElement
      result.current.textValueRef.current = textValueElement
      result.current.holdSpaceRef.current = holdSpaceElement

      act(() => {
        result.current.handleTextareaResize()
      })

      expect(result.current.isMultipleLine).toBe(false)
    })

    it('should handle exact boundary when combined width equals wrapper width', () => {
      const { result } = renderHook(() => useTextAreaHeight())

      const wrapperElement = document.createElement('div')
      const textareaElement = document.createElement('textarea')
      const textValueElement = document.createElement('div')
      const holdSpaceElement = document.createElement('div')

      vi.spyOn(wrapperElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(200, 0),
      )
      vi.spyOn(textareaElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(300, 20),
      )
      vi.spyOn(textValueElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(100, 0),
      )
      vi.spyOn(holdSpaceElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(100, 0), // total = 200, equals wrapperWidth
      )

      result.current.wrapperRef.current = wrapperElement
      result.current.textareaRef.current = textareaElement
      result.current.textValueRef.current = textValueElement
      result.current.holdSpaceRef.current = holdSpaceElement

      act(() => {
        result.current.handleTextareaResize()
      })

      expect(result.current.isMultipleLine).toBe(true)
    })

    it('should handle boundary case when textarea height equals 32px', () => {
      const { result } = renderHook(() => useTextAreaHeight())

      const wrapperElement = document.createElement('div')
      const textareaElement = document.createElement('textarea')
      const textValueElement = document.createElement('div')
      const holdSpaceElement = document.createElement('div')

      vi.spyOn(wrapperElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(300, 0),
      )
      vi.spyOn(textareaElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(300, 32), // exactly 32
      )
      vi.spyOn(textValueElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(100, 0),
      )
      vi.spyOn(holdSpaceElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(50, 0),
      )

      result.current.wrapperRef.current = wrapperElement
      result.current.textareaRef.current = textareaElement
      result.current.textValueRef.current = textValueElement
      result.current.holdSpaceRef.current = holdSpaceElement

      act(() => {
        result.current.handleTextareaResize()
      })

      // height = 32 is not > 32, so should check width condition
      expect(result.current.isMultipleLine).toBe(false)
    })
  })

  describe('handleTextareaResize', () => {
    it('should be a function', () => {
      const { result } = renderHook(() => useTextAreaHeight())
      expect(typeof result.current.handleTextareaResize).toBe('function')
    })

    it('should call handleComputeHeight when invoked', () => {
      const { result } = renderHook(() => useTextAreaHeight())

      const wrapperElement = document.createElement('div')
      const textareaElement = document.createElement('textarea')
      const textValueElement = document.createElement('div')
      const holdSpaceElement = document.createElement('div')

      vi.spyOn(wrapperElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(300, 0),
      )
      vi.spyOn(textareaElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(300, 64),
      )
      vi.spyOn(textValueElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(100, 0),
      )
      vi.spyOn(holdSpaceElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(50, 0),
      )

      result.current.wrapperRef.current = wrapperElement
      result.current.textareaRef.current = textareaElement
      result.current.textValueRef.current = textValueElement
      result.current.holdSpaceRef.current = holdSpaceElement

      act(() => {
        result.current.handleTextareaResize()
      })

      expect(result.current.isMultipleLine).toBe(true)
    })

    it('should update state based on new dimensions', () => {
      const { result } = renderHook(() => useTextAreaHeight())

      const wrapperElement = document.createElement('div')
      const textareaElement = document.createElement('textarea')
      const textValueElement = document.createElement('div')
      const holdSpaceElement = document.createElement('div')

      const wrapperRect = vi.spyOn(wrapperElement, 'getBoundingClientRect')
      const textareaRect = vi.spyOn(textareaElement, 'getBoundingClientRect')
      const textValueRect = vi.spyOn(textValueElement, 'getBoundingClientRect')
      const holdSpaceRect = vi.spyOn(holdSpaceElement, 'getBoundingClientRect')

      result.current.wrapperRef.current = wrapperElement
      result.current.textareaRef.current = textareaElement
      result.current.textValueRef.current = textValueElement
      result.current.holdSpaceRef.current = holdSpaceElement

      // First call - content fits
      wrapperRect.mockReturnValue(mockGetBoundingClientRect(300, 0))
      textareaRect.mockReturnValue(mockGetBoundingClientRect(300, 20))
      textValueRect.mockReturnValue(mockGetBoundingClientRect(100, 0))
      holdSpaceRect.mockReturnValue(mockGetBoundingClientRect(50, 0))

      act(() => {
        result.current.handleTextareaResize()
      })
      expect(result.current.isMultipleLine).toBe(false)

      // Second call - content overflows
      textareaRect.mockReturnValue(mockGetBoundingClientRect(300, 64))

      act(() => {
        result.current.handleTextareaResize()
      })
      expect(result.current.isMultipleLine).toBe(true)
    })
  })

  describe('Callback Stability', () => {
    it('should maintain ref objects across rerenders', () => {
      const { result, rerender } = renderHook(() => useTextAreaHeight())
      const firstWrapperRef = result.current.wrapperRef
      const firstTextareaRef = result.current.textareaRef
      const firstTextValueRef = result.current.textValueRef
      const firstHoldSpaceRef = result.current.holdSpaceRef

      rerender()

      expect(result.current.wrapperRef).toBe(firstWrapperRef)
      expect(result.current.textareaRef).toBe(firstTextareaRef)
      expect(result.current.textValueRef).toBe(firstTextValueRef)
      expect(result.current.holdSpaceRef).toBe(firstHoldSpaceRef)
    })
  })

  describe('Edge Cases', () => {
    it('should handle zero dimensions', () => {
      const { result } = renderHook(() => useTextAreaHeight())

      const wrapperElement = document.createElement('div')
      const textareaElement = document.createElement('textarea')
      const textValueElement = document.createElement('div')
      const holdSpaceElement = document.createElement('div')

      vi.spyOn(wrapperElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(0, 0),
      )
      vi.spyOn(textareaElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(0, 0),
      )
      vi.spyOn(textValueElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(0, 0),
      )
      vi.spyOn(holdSpaceElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(0, 0),
      )

      result.current.wrapperRef.current = wrapperElement
      result.current.textareaRef.current = textareaElement
      result.current.textValueRef.current = textValueElement
      result.current.holdSpaceRef.current = holdSpaceElement

      act(() => {
        result.current.handleTextareaResize()
      })

      // When all dimensions are 0, 0 + 0 >= 0 is true, so isMultipleLine is true
      expect(result.current.isMultipleLine).toBe(true)
    })

    it('should handle very large dimensions', () => {
      const { result } = renderHook(() => useTextAreaHeight())

      const wrapperElement = document.createElement('div')
      const textareaElement = document.createElement('textarea')
      const textValueElement = document.createElement('div')
      const holdSpaceElement = document.createElement('div')

      vi.spyOn(wrapperElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(10000, 0),
      )
      vi.spyOn(textareaElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(10000, 100),
      )
      vi.spyOn(textValueElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(5000, 0),
      )
      vi.spyOn(holdSpaceElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(5000, 0),
      )

      result.current.wrapperRef.current = wrapperElement
      result.current.textareaRef.current = textareaElement
      result.current.textValueRef.current = textValueElement
      result.current.holdSpaceRef.current = holdSpaceElement

      act(() => {
        result.current.handleTextareaResize()
      })

      expect(result.current.isMultipleLine).toBe(true)
    })

    it('should handle numeric precision edge cases', () => {
      const { result } = renderHook(() => useTextAreaHeight())

      const wrapperElement = document.createElement('div')
      const textareaElement = document.createElement('textarea')
      const textValueElement = document.createElement('div')
      const holdSpaceElement = document.createElement('div')

      vi.spyOn(wrapperElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(200.5, 0),
      )
      vi.spyOn(textareaElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(300, 20),
      )
      vi.spyOn(textValueElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(100.2, 0),
      )
      vi.spyOn(holdSpaceElement, 'getBoundingClientRect').mockReturnValue(
        mockGetBoundingClientRect(100.3, 0),
      )

      result.current.wrapperRef.current = wrapperElement
      result.current.textareaRef.current = textareaElement
      result.current.textValueRef.current = textValueElement
      result.current.holdSpaceRef.current = holdSpaceElement

      act(() => {
        result.current.handleTextareaResize()
      })

      expect(result.current.isMultipleLine).toBe(true)
    })
  })
})
