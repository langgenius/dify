'use client'

import { useEffect, useMemo, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { RiCloseLine, RiListUnordered } from '@remixicon/react'
import TemplateEn from './template/template.en.mdx'
import TemplateZh from './template/template.zh.mdx'
import TemplateJa from './template/template.ja.mdx'
import I18n from '@/context/i18n'
import { LanguagesSupported } from '@/i18n-config/language'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import cn from '@/utils/classnames'

type DocProps = {
  apiBaseUrl: string
}

const Doc = ({ apiBaseUrl }: DocProps) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const [toc, setToc] = useState<Array<{ href: string; text: string }>>([])
  const [isTocExpanded, setIsTocExpanded] = useState(false)
  const [activeSection, setActiveSection] = useState<string>('')
  const { theme } = useTheme()

  // Set initial TOC expanded state based on screen width
  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1280px)')
    setIsTocExpanded(mediaQuery.matches)
  }, [])

  // Extract TOC from article content
  useEffect(() => {
    const extractTOC = () => {
      const article = document.querySelector('article')
      if (article) {
        const headings = article.querySelectorAll('h2')
        const tocItems = Array.from(headings).map((heading) => {
          const anchor = heading.querySelector('a')
          if (anchor) {
            return {
              href: anchor.getAttribute('href') || '',
              text: anchor.textContent || '',
            }
          }
          return null
        }).filter((item): item is { href: string; text: string } => item !== null)
        setToc(tocItems)
        // Set initial active section
        if (tocItems.length > 0)
          setActiveSection(tocItems[0].href.replace('#', ''))
      }
    }

    setTimeout(extractTOC, 0)
  }, [locale])

  // Track scroll position for active section highlighting
  useEffect(() => {
    const handleScroll = () => {
      const scrollContainer = document.querySelector('.scroll-container')
      if (!scrollContainer || toc.length === 0)
        return

      // Find active section based on scroll position
      let currentSection = ''
      toc.forEach((item) => {
        const targetId = item.href.replace('#', '')
        const element = document.getElementById(targetId)
        if (element) {
          const rect = element.getBoundingClientRect()
          // Consider section active if its top is above the middle of viewport
          if (rect.top <= window.innerHeight / 2)
            currentSection = targetId
        }
      })

      if (currentSection && currentSection !== activeSection)
        setActiveSection(currentSection)
    }

    const scrollContainer = document.querySelector('.scroll-container')
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll)
      handleScroll() // Initial check
      return () => scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [toc, activeSection])

  // Handle TOC item click
  const handleTocClick = (e: React.MouseEvent<HTMLAnchorElement>, item: { href: string; text: string }) => {
    e.preventDefault()
    const targetId = item.href.replace('#', '')
    const element = document.getElementById(targetId)
    if (element) {
      const scrollContainer = document.querySelector('.scroll-container')
      if (scrollContainer) {
        const headerOffset = -40
        const elementTop = element.offsetTop - headerOffset
        scrollContainer.scrollTo({
          top: elementTop,
          behavior: 'smooth',
        })
      }
    }
  }

  const Template = useMemo(() => {
    switch (locale) {
      case LanguagesSupported[1]:
        return <TemplateZh apiBaseUrl={apiBaseUrl} />
      case LanguagesSupported[7]:
        return <TemplateJa apiBaseUrl={apiBaseUrl} />
      default:
        return <TemplateEn apiBaseUrl={apiBaseUrl} />
    }
  }, [apiBaseUrl, locale])

  return (
    <div className="flex">
      <div className={`fixed right-20 top-32 z-10 transition-all duration-150 ease-out ${isTocExpanded ? 'w-[280px]' : 'w-11'}`}>
        {isTocExpanded
          ? (
            <nav className="toc flex max-h-[calc(100vh-150px)] w-full flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-background-default-hover shadow-xl">
              <div className="relative z-10 flex items-center justify-between border-b border-components-panel-border-subtle bg-background-default-hover px-4 py-2.5">
                <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
                  {t('appApi.develop.toc')}
                </span>
                <button
                  onClick={() => setIsTocExpanded(false)}
                  className="group flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-state-base-hover"
                  aria-label="Close"
                >
                  <RiCloseLine className="h-3 w-3 text-text-quaternary transition-colors group-hover:text-text-secondary" />
                </button>
              </div>

              <div className="from-components-panel-border-subtle/20 pointer-events-none absolute left-0 right-0 top-[41px] z-10 h-2 bg-gradient-to-b to-transparent"></div>
              <div className="pointer-events-none absolute left-0 right-0 top-[43px] z-10 h-3 bg-gradient-to-b from-background-default-hover to-transparent"></div>

              <div className="relative flex-1 overflow-y-auto px-3 py-3 pt-1">
                {toc.length === 0 ? (
                  <div className="px-2 py-8 text-center text-xs text-text-quaternary">
                    {t('appApi.develop.noContent')}
                  </div>
                ) : (
                  <ul className="space-y-0.5">
                    {toc.map((item, index) => {
                      const isActive = activeSection === item.href.replace('#', '')
                      return (
                        <li key={index}>
                          <a
                            href={item.href}
                            onClick={e => handleTocClick(e, item)}
                            className={cn(
                              'group relative flex items-center rounded-md px-3 py-2 text-[13px] transition-all duration-200',
                              isActive
                                ? 'bg-state-base-hover font-medium text-text-primary'
                                : 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
                            )}
                          >
                            <span
                              className={cn(
                                'mr-2 h-1.5 w-1.5 rounded-full transition-all duration-200',
                                isActive
                                  ? 'scale-100 bg-text-accent'
                                  : 'scale-75 bg-components-panel-border',
                              )}
                            />
                            <span className="flex-1 truncate">
                              {item.text}
                            </span>
                          </a>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-4 rounded-b-xl bg-gradient-to-t from-background-default-hover to-transparent"></div>
            </nav>
          )
          : (
            <button
              onClick={() => setIsTocExpanded(true)}
              className="group flex h-11 w-11 items-center justify-center rounded-full border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg transition-all duration-150 hover:bg-background-default-hover hover:shadow-xl"
              aria-label="Open table of contents"
            >
              <RiListUnordered className="h-5 w-5 text-text-tertiary transition-colors group-hover:text-text-secondary" />
            </button>
          )}
      </div>
      <article className={cn('prose-xl prose mx-1 rounded-t-xl bg-background-default px-4 pt-16 sm:mx-12', theme === Theme.dark && 'prose-invert')}>
        {Template}
      </article>
    </div>
  )
}

export default Doc
