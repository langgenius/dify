import { useLayoutEffect, useState } from 'react'

type Params = {
  ref?: React.RefObject<HTMLDivElement | null>
  hasFooter?: boolean
  isInNode?: boolean
}

// Chrome (title bar + optional footer) heights subtracted from the wrap so
// the editor body never paints underneath its own controls.
const CHROME_HEIGHT_WITH_FOOTER = 56
const CHROME_HEIGHT_WITHOUT_FOOTER = 29

/**
 * Controls the expand/collapse behavior of the code editor wrapper used across
 * workflow nodes and execution-log panels.
 *
 * Returns:
 *  - `wrapClassName` / `wrapStyle` — positioning + shadow applied to the outer
 *    wrapper when the editor is expanded.
 *  - `editorExpandHeight` — height for the editor body (wrap minus chrome).
 *  - `isExpand` / `setIsExpand` — state + setter for the consumer.
 *
 * Height is measured via `useLayoutEffect` so the first expanded render
 * already has the correct value — the previous `useEffect` implementation
 * left the editor at the collapsed height for one paint on first expand.
 */
const useToggleExpend = ({ ref, hasFooter = true, isInNode }: Params) => {
  const [isExpand, setIsExpand] = useState(false)
  const [wrapHeight, setWrapHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    if (!ref?.current)
      return
    setWrapHeight(ref.current.clientHeight)
  }, [isExpand, ref])

  const chromeHeight = hasFooter ? CHROME_HEIGHT_WITH_FOOTER : CHROME_HEIGHT_WITHOUT_FOOTER
  const editorExpandHeight = isExpand && wrapHeight !== undefined
    ? Math.max(0, wrapHeight - chromeHeight)
    : 0

  const wrapClassName = (() => {
    if (!isExpand)
      return ''

    if (isInNode)
      return 'fixed z-10 right-[9px] top-[166px] bottom-[8px] p-4 bg-components-panel-bg rounded-xl'

    // Fill the nearest positioned ancestor entirely. Previously hardcoded
    // `top-[52px] left-4 right-6` offsets assumed a 52px header above the
    // scroll container — that assumption no longer holds in the conversation
    // log (result-panel) layout, where the status bar above the editor is
    // taller than 52px, causing the expanded panel to partially overlap the
    // status bar (issue #34887).
    return 'absolute z-10 inset-0 pb-4 bg-components-panel-bg'
  })()

  const wrapStyle = isExpand
    ? {
        boxShadow: '0px 0px 12px -4px rgba(16, 24, 40, 0.05), 0px -3px 6px -2px rgba(16, 24, 40, 0.03)',
      }
    : {}

  return {
    wrapClassName,
    wrapStyle,
    editorExpandHeight,
    isExpand,
    setIsExpand,
  }
}

export default useToggleExpend
