'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { RiListUnordered } from '@remixicon/react'
import TemplateEn from './template/template.en.mdx'
import TemplateZh from './template/template.zh.mdx'
import TemplateJa from './template/template.ja.mdx'
import TemplateAdvancedChatEn from './template/template_advanced_chat.en.mdx'
import TemplateAdvancedChatZh from './template/template_advanced_chat.zh.mdx'
import TemplateAdvancedChatJa from './template/template_advanced_chat.ja.mdx'
import TemplateWorkflowEn from './template/template_workflow.en.mdx'
import TemplateWorkflowZh from './template/template_workflow.zh.mdx'
import TemplateWorkflowJa from './template/template_workflow.ja.mdx'
import TemplateChatEn from './template/template_chat.en.mdx'
import TemplateChatZh from './template/template_chat.zh.mdx'
import TemplateChatJa from './template/template_chat.ja.mdx'
import I18n from '@/context/i18n'
import { LanguagesSupported } from '@/i18n/language'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import cn from '@/utils/classnames'
import { throttle } from 'lodash-es'

type TocItem = {
  href: string;
  text: string;
  index: number;
}

type IDocProps = {
  appDetail: any
}

const useToc = (appDetail: any, locale: string) => {
  const [toc, setToc] = useState<TocItem[]>([])
  const [headingElements, setHeadingElements] = useState<HTMLElement[]>([])

  useEffect(() => {
    const extractTOC = () => {
      const article = document.querySelector('article')
      if (article) {
        const headings = article.querySelectorAll('h2')
        const headingElementsArray = Array.from(headings) as HTMLElement[]
        setHeadingElements(headingElementsArray)

        const tocItems: TocItem[] = headingElementsArray.map((heading, index) => ({
          href: `#section-${index}`,
          text: (heading.textContent || `章节 ${index + 1}`).trim(),
          index,
        }))

        setToc(tocItems)
      }
    }

    const timeoutId = setTimeout(extractTOC, 0)
    return () => clearTimeout(timeoutId)
  }, [appDetail, locale])

  return { toc, headingElements }
}

const useScrollPosition = (headingElements: HTMLElement[]) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const activeIndexRef = useRef<number | null>(null)

  useEffect(() => {
    const scrollContainer = document.querySelector('.overflow-auto')
    if (!scrollContainer || headingElements.length === 0) return

    const handleScroll = () => {
      const scrollContainerTop = scrollContainer.scrollTop
      const scrollContainerHeight = scrollContainer.clientHeight
      const scrollContainerBottom = scrollContainerTop + scrollContainerHeight
      const totalScrollHeight = scrollContainer.scrollHeight
      const offset = 80

      let currentActiveIndex: number | null = null

      for (let i = headingElements.length - 1; i >= 0; i--) {
        const heading = headingElements[i]
        const headingTop = heading.offsetTop
        const headingBottom = headingTop + heading.offsetHeight

        if (headingTop <= scrollContainerTop + offset) {
          currentActiveIndex = i
          break
        }
      }

      if (scrollContainerBottom >= totalScrollHeight - 20) {
        currentActiveIndex = headingElements.length - 1
      }
      else if (currentActiveIndex === null && headingElements.length > 0) {
        const firstHeadingTop = headingElements[0].offsetTop
        if (firstHeadingTop >= scrollContainerTop && firstHeadingTop < scrollContainerBottom)
          currentActiveIndex = 0
      }

      if (currentActiveIndex !== activeIndexRef.current) {
        activeIndexRef.current = currentActiveIndex
        setActiveIndex(currentActiveIndex)
      }
    }

    const throttledScrollHandler = throttle(handleScroll, 100)
    scrollContainer.addEventListener('scroll', throttledScrollHandler)
    handleScroll()

    return () => {
      scrollContainer.removeEventListener('scroll', throttledScrollHandler)
      throttledScrollHandler.cancel()
    }
  }, [headingElements])

  return activeIndex
}

const useResponsiveToc = () => {
  const [isTocExpanded, setIsTocExpanded] = useState(false)
  const userToggled = useRef(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1280px)')

    if (!userToggled.current)
      setIsTocExpanded(mediaQuery.matches)

    const handleChange = (e: MediaQueryListEvent) => {
      if (!userToggled.current)
        setIsTocExpanded(e.matches)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  const setTocExpandedWithTracking = (expanded: boolean) => {
    userToggled.current = true
    setIsTocExpanded(expanded)
  }

  return { isTocExpanded, setIsTocExpanded: setTocExpandedWithTracking }
}

const Doc = ({ appDetail }: IDocProps) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const { toc, headingElements } = useToc(appDetail, locale)
  const { isTocExpanded, setIsTocExpanded } = useResponsiveToc()
  const activeIndex = useScrollPosition(headingElements)
  const { theme } = useTheme()

  const variables = appDetail?.model_config?.configs?.prompt_variables || []
  const inputs = variables.reduce((res: any, variable: any) => {
    res[variable.key] = variable.name || ''
    return res
  }, {})

  const handleTocClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>, item: TocItem) => {
    e.preventDefault()

    const targetElement = headingElements[item.index]

    if (targetElement) {
      const scrollContainer = document.querySelector('.overflow-auto')
      if (scrollContainer) {
        const headerOffset = 80
        const elementTop = targetElement.offsetTop - headerOffset
        scrollContainer.scrollTo({
          top: elementTop,
          behavior: 'smooth',
        })
      }
    }
  }, [headingElements])

  const Template = useMemo(() => {
    if (appDetail?.mode === 'chat' || appDetail?.mode === 'agent-chat') {
      switch (locale) {
        case LanguagesSupported[1]:
          return <TemplateChatZh appDetail={appDetail} variables={variables} inputs={inputs} />
        case LanguagesSupported[7]:
          return <TemplateChatJa appDetail={appDetail} variables={variables} inputs={inputs} />
        default:
          return <TemplateChatEn appDetail={appDetail} variables={variables} inputs={inputs} />
      }
    }
    if (appDetail?.mode === 'advanced-chat') {
      switch (locale) {
        case LanguagesSupported[1]:
          return <TemplateAdvancedChatZh appDetail={appDetail} variables={variables} inputs={inputs} />
        case LanguagesSupported[7]:
          return <TemplateAdvancedChatJa appDetail={appDetail} variables={variables} inputs={inputs} />
        default:
          return <TemplateAdvancedChatEn appDetail={appDetail} variables={variables} inputs={inputs} />
      }
    }
    if (appDetail?.mode === 'workflow') {
      switch (locale) {
        case LanguagesSupported[1]:
          return <TemplateWorkflowZh appDetail={appDetail} variables={variables} inputs={inputs} />
        case LanguagesSupported[7]:
          return <TemplateWorkflowJa appDetail={appDetail} variables={variables} inputs={inputs} />
        default:
          return <TemplateWorkflowEn appDetail={appDetail} variables={variables} inputs={inputs} />
      }
    }
    if (appDetail?.mode === 'completion') {
      switch (locale) {
        case LanguagesSupported[1]:
          return <TemplateZh appDetail={appDetail} variables={variables} inputs={inputs} />
        case LanguagesSupported[7]:
          return <TemplateJa appDetail={appDetail} variables={variables} inputs={inputs} />
        default:
          return <TemplateEn appDetail={appDetail} variables={variables} inputs={inputs} />
      }
    }
    return null
  }, [appDetail, locale, variables, inputs])

  return (
    <div className="flex">
      <div className={`fixed right-8 top-32 z-10 transition-all ${isTocExpanded ? 'w-64' : 'w-10'}`}>
        {isTocExpanded
          ? (
            <nav className="toc max-h-[calc(100vh-150px)] w-full overflow-y-auto rounded-lg bg-components-panel-bg p-4 shadow-md">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-text-primary">{t('appApi.develop.toc')}</h3>
                <button
                  onClick={() => setIsTocExpanded(false)}
                  className="text-text-tertiary hover:text-text-secondary"
                >
                  ✕
                </button>
              </div>
              <ul className="space-y-2">
                {toc.map(item => (
                  <li key={item.index}>
                    <a
                      href={item.href}
                      className={cn(
                        'block rounded px-2 py-1 text-sm transition-colors duration-200',
                        item.index === activeIndex
                          ? 'bg-primary-50 font-semibold text-primary-600'
                          : 'text-text-secondary hover:bg-gray-100 hover:text-text-primary',
                      )}
                      onClick={e => handleTocClick(e, item)}
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )
          : (
            <button
              onClick={() => setIsTocExpanded(true)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-components-button-secondary-bg shadow-md transition-colors duration-200 hover:bg-components-button-secondary-bg-hover"
            >
              <RiListUnordered className="h-6 w-6 text-components-button-secondary-text" />
            </button>
          )}
      </div>
      <article className={cn('prose-xl prose mx-1 overflow-auto rounded-t-xl bg-background-default px-4 pt-16 sm:mx-12', theme === Theme.dark && 'dark:prose-invert')}>
        {Template}
      </article>
    </div>
  )
}

export default Doc
