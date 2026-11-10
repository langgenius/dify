import { act, renderHook } from '@testing-library/react'
import { useTextAreaHeight } from '../hooks'

const setup = () => {
  const hook = renderHook(() => useTextAreaHeight())
  const wrapper = document.createElement('div')
  const textarea = document.createElement('textarea')
  const text = document.createElement('div')
  const controls = document.createElement('div')
  hook.result.current.wrapperRef.current = wrapper
  hook.result.current.textareaRef.current = textarea
  hook.result.current.textValueRef.current = text
  hook.result.current.holdSpaceRef.current = controls
  const dimensions = { width: 300, height: 32, textWidth: 100, controlsWidth: 50 }
  vi.spyOn(wrapper, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, dimensions.width, 0),
  )
  vi.spyOn(textarea, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, dimensions.width, dimensions.height),
  )
  vi.spyOn(text, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, dimensions.textWidth, 0),
  )
  vi.spyOn(controls, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, dimensions.controlsWidth, 0),
  )
  return { ...hook, dimensions }
}

describe('useTextAreaHeight', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    { height: 64, textWidth: 100, expected: true },
    { height: 32, textWidth: 100, expected: false },
    { height: 20, textWidth: 251, expected: true },
    { height: 20, textWidth: 250, expected: true },
    { height: 20, textWidth: 249.5, expected: false },
  ])(
    'uses multiline layout for height=$height and text width=$textWidth: $expected',
    ({ height, textWidth, expected }) => {
      const { result, dimensions } = setup()
      Object.assign(dimensions, { height, textWidth })

      act(() => result.current.handleTextareaResize())

      expect(result.current.isMultipleLine).toBe(expected)
    },
  )

  it('returns to the compact layout after content shrinks and ignores a detached textarea', () => {
    const { result, dimensions } = setup()
    dimensions.height = 64
    act(() => result.current.handleTextareaResize())
    expect(result.current.isMultipleLine).toBe(true)

    dimensions.height = 32
    act(() => result.current.handleTextareaResize())
    expect(result.current.isMultipleLine).toBe(false)

    result.current.textareaRef.current = undefined
    dimensions.textWidth = 400
    act(() => result.current.handleTextareaResize())
    expect(result.current.isMultipleLine).toBe(false)
  })
})
