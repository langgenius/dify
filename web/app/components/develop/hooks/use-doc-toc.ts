import { useCallback, useEffect, useState } from 'react'

export type TocItem = {
  href: string
  text: string
}

type UseDocTocOptions = {
  appDetail: Record<string, unknown> | null
  locale: string
}

const HEADER_OFFSET = 80
const SCROLL_CONTAINER_SELECTOR = '.overflow-auto'

const getTargetId = (href: string) => href.replace('#', '')

/**
 * Extract heading anchors from the rendered <article> as TOC items.
 */
const extractTocFromArticle = (): TocItem[] => {
  const article = document.querySelector('article')
  if (!article)
    return []

  return Array.from(article.querySelectorAll('h2'))
    .map((heading) => {
      const anchor = heading.querySelector('a')
      if (!anchor)
        return null
      return {
        href: anchor.getAttribute('href') || '',
        text: anchor.textContent || '',
      }
    })
    .filter((item): item is TocItem => item !== null)
}

/**
 * Custom hook that manages table-of-contents state:
 * - Extracts TOC items from rendered headings
 * - Tracks the active section on scroll
 * - Auto-expands the panel on wide viewports
 */
export const useDocToc = ({ appDetail, locale }: UseDocTocOptions) => {
  const [toc, setToc] = useState<TocItem[]>([])
  const [isTocExpanded, setIsTocExpanded] = useState(() => {
    if (typeof window === 'undefined')
      return false
    return window.matchMedia('(min-width: 1280px)').matches
  })
  const [activeSection, setActiveSection] = useState<string>('')

  // Re-extract TOC items whenever the doc content changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const tocItems = extractTocFromArticle()
      setToc(tocItems)
      if (tocItems.length > 0)
        setActiveSection(getTargetId(tocItems[0].href))
    }, 0)
    return () => clearTimeout(timer)
  }, [appDetail, locale])

  // Track active section based on scroll position
  useEffect(() => {
    const scrollContainer = document.querySelector(SCROLL_CONTAINER_SELECTOR)
    if (!scrollContainer || toc.length === 0)
      return

    const handleScroll = () => {
      let currentSection = ''
      for (const item of toc) {
        const targetId = getTargetId(item.href)
        const element = document.getElementById(targetId)
        if (element) {
          const rect = element.getBoundingClientRect()
          if (rect.top <= window.innerHeight / 2)
            currentSection = targetId
        }
      }

      if (currentSection && currentSection !== activeSection)
        setActiveSection(currentSection)
    }

    scrollContainer.addEventListener('scroll', handleScroll)
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [toc, activeSection])

  // Smooth-scroll to a TOC target on click
  const handleTocClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>, item: TocItem) => {
    e.preventDefault()
    const targetId = getTargetId(item.href)
    const element = document.getElementById(targetId)
    if (!element)
      return

    const scrollContainer = document.querySelector(SCROLL_CONTAINER_SELECTOR)
    if (scrollContainer) {
      scrollContainer.scrollTo({
        top: element.offsetTop - HEADER_OFFSET,
        behavior: 'smooth',
      })
    }
  }, [])

  return {
    toc,
    isTocExpanded,
    setIsTocExpanded,
    activeSection,
    handleTocClick,
  }
}
