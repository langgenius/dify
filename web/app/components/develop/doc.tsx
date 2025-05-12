'use client'
import { useEffect, useState } from 'react'
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

type IDocProps = {
  appDetail: any
}

const Doc = ({ appDetail }: IDocProps) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const [toc, setToc] = useState<Array<{ href: string; text: string }>>([])
  const [isTocExpanded, setIsTocExpanded] = useState(false)
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
        }).filter((item): item is { href: string; text: string } => item !== null)
        setToc(tocItems)
      }
    }

    // Run after component has rendered
    setTimeout(extractTOC, 0)
  }, [appDetail, locale])

  const handleTocClick = (e: React.MouseEvent<HTMLAnchorElement>, item: { href: string; text: string }) => {
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
                {toc.map((item, index) => (
                  <li key={index}>
                    <a
                      href={item.href}
                      className="text-text-secondary transition-colors duration-200 hover:text-text-primary hover:underline"
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
      <article className={cn('prose-xl prose', theme === Theme.dark && 'dark:prose-invert')} >
        {(appDetail?.mode === 'chat' || appDetail?.mode === 'agent-chat') && (
          (() => {
            switch (locale) {
              case LanguagesSupported[1]:
                return <TemplateChatZh appDetail={appDetail} variables={variables} inputs={inputs} />
              case LanguagesSupported[7]:
                return <TemplateChatJa appDetail={appDetail} variables={variables} inputs={inputs} />
              default:
                return <TemplateChatEn appDetail={appDetail} variables={variables} inputs={inputs} />
            }
          })()
        )}
        {appDetail?.mode === 'advanced-chat' && (
          (() => {
            switch (locale) {
              case LanguagesSupported[1]:
                return <TemplateAdvancedChatZh appDetail={appDetail} variables={variables} inputs={inputs} />
              case LanguagesSupported[7]:
                return <TemplateAdvancedChatJa appDetail={appDetail} variables={variables} inputs={inputs} />
              default:
                return <TemplateAdvancedChatEn appDetail={appDetail} variables={variables} inputs={inputs} />
            }
          })()
        )}
        {appDetail?.mode === 'workflow' && (
          (() => {
            switch (locale) {
              case LanguagesSupported[1]:
                return <TemplateWorkflowZh appDetail={appDetail} variables={variables} inputs={inputs} />
              case LanguagesSupported[7]:
                return <TemplateWorkflowJa appDetail={appDetail} variables={variables} inputs={inputs} />
              default:
                return <TemplateWorkflowEn appDetail={appDetail} variables={variables} inputs={inputs} />
            }
          })()
        )}
        {appDetail?.mode === 'completion' && (
          (() => {
            switch (locale) {
              case LanguagesSupported[1]:
                return <TemplateZh appDetail={appDetail} variables={variables} inputs={inputs} />
              case LanguagesSupported[7]:
                return <TemplateJa appDetail={appDetail} variables={variables} inputs={inputs} />
              default:
                return <TemplateEn appDetail={appDetail} variables={variables} inputs={inputs} />
            }
          })()
        )}
      </article>
    </div>
  )
}

export default Doc
