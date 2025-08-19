import { useEffect, useState } from 'react'

type Params = {
  ref?: React.RefObject<HTMLDivElement | null>
  hasFooter?: boolean
  isInNode?: boolean
}

const useToggleExpend = ({ ref, hasFooter = true, isInNode }: Params) => {
  const [isExpand, setIsExpand] = useState(false)
  const [wrapHeight, setWrapHeight] = useState(ref?.current?.clientHeight)
  const editorExpandHeight = isExpand ? wrapHeight! - (hasFooter ? 56 : 29) : 0
  useEffect(() => {
    if (!ref?.current) return
    setWrapHeight(ref.current?.clientHeight)
  }, [isExpand])

  const wrapClassName = (() => {
    if (!isExpand)
      return ''

    if (isInNode)
      return 'fixed z-10  right-[9px] top-[166px] bottom-[8px]  p-4 bg-components-panel-bg rounded-xl'

    return 'absolute z-10 left-4 right-6 top-[52px] bottom-0 pb-4 bg-components-panel-bg'
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
