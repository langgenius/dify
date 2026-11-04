import { act, renderHook } from '@testing-library/react'
import useToggleExpend from '../use-toggle-expend'

it.each([
  { hasFooter: false, height: 400, expected: 371 },
  { hasFooter: true, height: 400, expected: 344 },
  { hasFooter: true, height: 20, expected: 0 },
])(
  'reserves editor chrome and clamps the body height ($hasFooter, $height)',
  ({ hasFooter, height, expected }) => {
    const element = document.createElement('div')
    Object.defineProperty(element, 'clientHeight', { value: height })
    const ref = { current: element }
    const { result } = renderHook(() => useToggleExpend({ ref, hasFooter }))
    act(() => result.current.setIsExpand(true))
    expect(result.current.editorExpandHeight).toBe(expected)
    act(() => result.current.setIsExpand(false))
    expect(result.current.editorExpandHeight).toBe(0)
  },
)
