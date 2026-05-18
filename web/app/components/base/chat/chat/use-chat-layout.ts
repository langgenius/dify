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

const setStyleValue = (element: HTMLElement, property: 'paddingBottom' | 'width', value: string) => {
  if (element.style[property] !== value)
    element.style[property] = value
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
  const resizeObserverFrameRef = useRef<number | null>(null)
  const pendingFooterBlockSizeRef = useRef<number | null>(null)
  const pendingContainerInlineSizeRef = useRef<number | null>(null)

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
    if (chatContainerRef.current) {
      const nextWidth = document.body.clientWidth - (chatContainerRef.current.clientWidth + 16) - 8
      setWidth(currentWidth => currentWidth === nextWidth ? currentWidth : nextWidth)
    }

    if (chatContainerRef.current && chatFooterRef.current)
      setStyleValue(chatFooterRef.current, 'width', `${chatContainerRef.current.clientWidth}px`)

    if (chatContainerInnerRef.current && chatFooterInnerRef.current)
      setStyleValue(chatFooterInnerRef.current, 'width', `${chatContainerInnerRef.current.clientWidth}px`)
  }, [])

  const scheduleResizeObserverUpdate = useCallback(() => {
    if (resizeObserverFrameRef.current !== null)
      return

    resizeObserverFrameRef.current = requestAnimationFrame(() => {
      resizeObserverFrameRef.current = null

      const footerBlockSize = pendingFooterBlockSizeRef.current
      pendingFooterBlockSizeRef.current = null
      if (footerBlockSize !== null && chatContainerRef.current) {
        setStyleValue(chatContainerRef.current, 'paddingBottom', `${footerBlockSize}px`)
        handleScrollToBottom()
      }

      const containerInlineSize = pendingContainerInlineSizeRef.current
      pendingContainerInlineSizeRef.current = null
      if (containerInlineSize !== null && chatFooterRef.current)
        setStyleValue(chatFooterRef.current, 'width', `${containerInlineSize}px`)
    })
  }, [handleScrollToBottom])

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
          pendingFooterBlockSizeRef.current = blockSize
        }
        scheduleResizeObserverUpdate()
      })
      resizeContainerObserver.observe(chatFooterRef.current)

      const resizeFooterObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { inlineSize } = entry.borderBoxSize[0]!
          pendingContainerInlineSizeRef.current = inlineSize
        }
        scheduleResizeObserverUpdate()
      })
      resizeFooterObserver.observe(chatContainerRef.current)

      return () => {
        if (resizeObserverFrameRef.current !== null) {
          cancelAnimationFrame(resizeObserverFrameRef.current)
          resizeObserverFrameRef.current = null
        }
        resizeContainerObserver.disconnect()
        resizeFooterObserver.disconnect()
      }
    }
  }, [scheduleResizeObserverUpdate])

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
