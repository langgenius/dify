import type { ChatItem } from '../types'
import { debounce } from 'es-toolkit/compat'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

type UseChatLayoutOptions = {
  chatList: ChatItem[]
  sidebarCollapseState?: boolean
}

export const useChatLayout = ({ chatList, sidebarCollapseState }: UseChatLayoutOptions) => {
  const [width, setWidth] = useState(0)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const chatContainerInnerRef = useRef<HTMLDivElement>(null)
  const chatFooterRef = useRef<HTMLDivElement>(null)
  const chatFooterInnerRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)
  const isAutoScrollingRef = useRef(false)
  const prevFirstMessageIdRef = useRef<string | undefined>(undefined)

  const handleScrollToBottom = useCallback(() => {
    if (chatList.length > 1 && chatContainerRef.current && !userScrolledRef.current) {
      isAutoScrollingRef.current = true
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight

      requestAnimationFrame(() => {
        isAutoScrollingRef.current = false
      })
    }
  }, [chatList.length])

  const handleWindowResize = useCallback(() => {
    if (chatContainerRef.current)
      setWidth(document.body.clientWidth - (chatContainerRef.current.clientWidth + 16) - 8)

    if (chatContainerRef.current && chatFooterRef.current)
      chatFooterRef.current.style.width = `${chatContainerRef.current.clientWidth}px`

    if (chatContainerInnerRef.current && chatFooterInnerRef.current)
      chatFooterInnerRef.current.style.width = `${chatContainerInnerRef.current.clientWidth}px`
  }, [])

  useEffect(() => {
    handleScrollToBottom()
    const animationFrame = requestAnimationFrame(handleWindowResize)

    return () => {
      cancelAnimationFrame(animationFrame)
    }
  }, [handleScrollToBottom, handleWindowResize])

  useEffect(() => {
    if (chatContainerRef.current) {
      requestAnimationFrame(() => {
        handleScrollToBottom()
        handleWindowResize()
      })
    }
  })

  useEffect(() => {
    const debouncedHandler = debounce(handleWindowResize, 200)
    window.addEventListener('resize', debouncedHandler)

    return () => {
      window.removeEventListener('resize', debouncedHandler)
      debouncedHandler.cancel()
    }
  }, [handleWindowResize])

  useEffect(() => {
    if (chatFooterRef.current && chatContainerRef.current) {
      const resizeContainerObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { blockSize } = entry.borderBoxSize[0]!
          chatContainerRef.current!.style.paddingBottom = `${blockSize}px`
          handleScrollToBottom()
        }
      })
      resizeContainerObserver.observe(chatFooterRef.current)

      const resizeFooterObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { inlineSize } = entry.borderBoxSize[0]!
          chatFooterRef.current!.style.width = `${inlineSize}px`
        }
      })
      resizeFooterObserver.observe(chatContainerRef.current)

      return () => {
        resizeContainerObserver.disconnect()
        resizeFooterObserver.disconnect()
      }
    }
  }, [handleScrollToBottom])

  useEffect(() => {
    const setUserScrolled = () => {
      const container = chatContainerRef.current
      if (!container)
        return
      if (isAutoScrollingRef.current)
        return

      const distanceToBottom = container.scrollHeight - container.clientHeight - container.scrollTop
      const scrollUpThreshold = 100

      userScrolledRef.current = distanceToBottom > scrollUpThreshold
    }

    const container = chatContainerRef.current
    if (!container)
      return

    container.addEventListener('scroll', setUserScrolled)
    return () => container.removeEventListener('scroll', setUserScrolled)
  }, [])

  useEffect(() => {
    const firstMessageId = chatList[0]?.id
    if (chatList.length <= 1 || (firstMessageId && prevFirstMessageIdRef.current !== firstMessageId))
      userScrolledRef.current = false
    prevFirstMessageIdRef.current = firstMessageId
  }, [chatList])

  useEffect(() => {
    if (!sidebarCollapseState) {
      const timer = setTimeout(handleWindowResize, 200)
      return () => clearTimeout(timer)
    }
  }, [handleWindowResize, sidebarCollapseState])

  return {
    width,
    chatContainerRef,
    chatContainerInnerRef,
    chatFooterRef,
    chatFooterInnerRef,
  }
}
