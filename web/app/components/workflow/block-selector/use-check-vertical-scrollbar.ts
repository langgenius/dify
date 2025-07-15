import { useEffect, useState } from 'react'

const useCheckVerticalScrollbar = (ref: React.RefObject<HTMLElement>) => {
  const [hasVerticalScrollbar, setHasVerticalScrollbar] = useState(false)

  useEffect(() => {
    const elem = ref.current
    if (!elem) return

    const checkScrollbar = () => {
      setHasVerticalScrollbar(elem.scrollHeight > elem.clientHeight)
    }

    checkScrollbar()

    const resizeObserver = new ResizeObserver(checkScrollbar)
    resizeObserver.observe(elem)

    const mutationObserver = new MutationObserver(checkScrollbar)
    mutationObserver.observe(elem, { childList: true, subtree: true, characterData: true })

    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [ref])

  return hasVerticalScrollbar
}

export default useCheckVerticalScrollbar
