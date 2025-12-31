'use client'
import { RiCloseLine, RiListUnordered } from '@remixicon/react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { LanguagesSupported } from '@/i18n-config/language'
import { AppModeEnum, Theme } from '@/types/app'
import { cn } from '@/utils/classnames'
import TemplateEn from './template/template.en.mdx'
import TemplateJa from './template/template.ja.mdx'
import TemplateZh from './template/template.zh.mdx'
import TemplateAdvancedChatEn from './template/template_advanced_chat.en.mdx'
import TemplateAdvancedChatJa from './template/template_advanced_chat.ja.mdx'
import TemplateAdvancedChatZh from './template/template_advanced_chat.zh.mdx'
import TemplateChatEn from './template/template_chat.en.mdx'
import TemplateChatJa from './template/template_chat.ja.mdx'
import TemplateChatZh from './template/template_chat.zh.mdx'
import TemplateWorkflowEn from './template/template_workflow.en.mdx'
import TemplateWorkflowJa from './template/template_workflow.ja.mdx'
import TemplateWorkflowZh from './template/template_workflow.zh.mdx'

type IDocProps = {
  appDetail: any
}

const Doc = ({ appDetail }: IDocProps) => {
  const locale = useLocale()
  const { t } = useTranslation()
  const [toc, setToc] = useState<Array<{ href: string, text: string }>>([])
  const [isTocExpanded, setIsTocExpanded] = useState(false)
  const [activeSection, setActiveSection] = useState<string>('')
  const { theme } = useTheme()

  const variables = appDetail?.model_config?.configs?.prompt_variables || []
  const inputs = variables.reduce((res: any, variable: any) => {
    res[variable.key] = variable.name || ''
    return res
  }, {})

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1280px)')
    setIsTocExpanded(mediaQuery.matches)
  }, [])

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
        }).filter((item): item is { href: string, text: string } => item !== null)
        setToc(tocItems)
        if (tocItems.length > 0)
          setActiveSection(tocItems[0].href.replace('#', ''))
      }
    }

    setTimeout(extractTOC, 0)
  }, [appDetail, locale])

  useEffect(() => {
    const handleScroll = () => {
      const scrollContainer = document.querySelector('.overflow-auto')
      if (!scrollContainer || toc.length === 0)
        return

      let currentSection = ''
      toc.forEach((item) => {
        const targetId = item.href.replace('#', '')
        const element = document.getElementById(targetId)
        if (element) {
          const rect = element.getBoundingClientRect()
          if (rect.top <= window.innerHeight / 2)
            currentSection = targetId
        }
      })

      if (currentSection && currentSection !== activeSection)
        setActiveSection(currentSection)
    }

    const scrollContainer = document.querySelector('.overflow-auto')
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll)
      handleScroll()
      return () => scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [toc, activeSection])

  const handleTocClick = (e: React.MouseEvent<HTMLAnchorElement>, item: { href: string, text: string }) => {
    e.preventDefault()
    const targetId = item.href.replace('#', '')
    const element = document.getElementById(targetId)
    if (element) {
      const scrollContainer = document.querySelector('.overflow-auto')
      if (scrollContainer) {
        const headerOffset = 80
        const elementTop = element.offsetTop - headerOffset
        scrollContainer.scrollTo({
          top: elementTop,
          behavior: 'smooth',
        })
      }
    }
  }

  const Template = useMemo(() => {
    if (appDetail?.mode === AppModeEnum.CHAT || appDetail?.mode === AppModeEnum.AGENT_CHAT) {
      switch (locale) {
        case LanguagesSupported[1]:
          return <TemplateChatZh appDetail={appDetail} variables={variables} inputs={inputs} />
        case LanguagesSupported[7]:
          return <TemplateChatJa appDetail={appDetail} variables={variables} inputs={inputs} />
        default:
          return <TemplateChatEn appDetail={appDetail} variables={variables} inputs={inputs} />
      }
    }
    if (appDetail?.mode === AppModeEnum.ADVANCED_CHAT) {
      switch (locale) {
        case LanguagesSupported[1]:
          return <TemplateAdvancedChatZh appDetail={appDetail} variables={variables} inputs={inputs} />
        case LanguagesSupported[7]:
          return <TemplateAdvancedChatJa appDetail={appDetail} variables={variables} inputs={inputs} />
        default:
          return <TemplateAdvancedChatEn appDetail={appDetail} variables={variables} inputs={inputs} />
      }
    }
    if (appDetail?.mode === AppModeEnum.WORKFLOW) {
      switch (locale) {
        case LanguagesSupported[1]:
          return <TemplateWorkflowZh appDetail={appDetail} variables={variables} inputs={inputs} />
        case LanguagesSupported[7]:
          return <TemplateWorkflowJa appDetail={appDetail} variables={variables} inputs={inputs} />
        default:
          return <TemplateWorkflowEn appDetail={appDetail} variables={variables} inputs={inputs} />
      }
    }
    if (appDetail?.mode === AppModeEnum.COMPLETION) {
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
      <div className={`fixed right-20 top-32 z-10 transition-all duration-150 ease-out ${isTocExpanded ? 'w-[280px]' : 'w-11'}`}>
        {isTocExpanded
          ? (
              <nav className="toc flex max-h-[calc(100vh-150px)] w-full flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-background-default-hover shadow-xl">
                <div className="relative z-10 flex items-center justify-between border-b border-components-panel-border-subtle bg-background-default-hover px-4 py-2.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
                    {t('develop.toc', { ns: 'appApi' })}
                  </span>
                  <button
                    type="button"
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
                  {toc.length === 0
                    ? (
                        <div className="px-2 py-8 text-center text-xs text-text-quaternary">
                          {t('develop.noContent', { ns: 'appApi' })}
                        </div>
                      )
                    : (
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
                type="button"
                onClick={() => setIsTocExpanded(true)}
                className="group flex h-11 w-11 items-center justify-center rounded-full border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg transition-all duration-150 hover:bg-background-default-hover hover:shadow-xl"
                aria-label="Open table of contents"
              >
                <RiListUnordered className="h-5 w-5 text-text-tertiary transition-colors group-hover:text-text-secondary" />
              </button>
            )}
      </div>
      <article className={cn('prose-xl prose', theme === Theme.dark && 'prose-invert')}>
        {Template}
      </article>
    </div>
  )
}

export default Doc
