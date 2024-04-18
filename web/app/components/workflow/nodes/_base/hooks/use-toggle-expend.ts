import { useEffect, useState } from 'react'

type Params = {
  ref: React.RefObject<HTMLDivElement>
  hasFooter?: boolean
}

const useToggleExpend = ({ ref, hasFooter = true }: Params) => {
  const [isExpand, setIsExpand] = useState(false)
  const [wrapHeight, setWrapHeight] = useState(ref.current?.clientHeight)
  const editorExpandHeight = isExpand ? wrapHeight! - (hasFooter ? 56 : 29) : 0
  useEffect(() => {
    setWrapHeight(ref.current?.clientHeight)
  }, [isExpand])

  const wrapClassName = isExpand && 'absolute z-10 left-4 right-6 top-[52px] bottom-0 pb-4 bg-white'

  return {
    wrapClassName,
    editorExpandHeight,
    isExpand,
    setIsExpand,
  }
}

export default useToggleExpend
