'use client'
import { useEffect, useState } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import TemplateEn from './template/template.en.mdx'
import TemplateZh from './template/template.zh.mdx'
import TemplateAdvancedChatEn from './template/template_advanced_chat.en.mdx'
import TemplateAdvancedChatZh from './template/template_advanced_chat.zh.mdx'
import TemplateWorkflowEn from './template/template_workflow.en.mdx'
import TemplateWorkflowZh from './template/template_workflow.zh.mdx'
import TemplateChatEn from './template/template_chat.en.mdx'
import TemplateChatZh from './template/template_chat.zh.mdx'
import I18n from '@/context/i18n'
import { LanguagesSupported } from '@/i18n/language'

type IDocProps = {
  appDetail: any
}

const Doc = ({ appDetail }: IDocProps) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const [toc, setToc] = useState<Array<{ href: string; text: string }>>([])

  const variables = appDetail?.model_config?.configs?.prompt_variables || []
  const inputs = variables.reduce((res: any, variable: any) => {
    res[variable.key] = variable.name || ''
    return res
  }, {})

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

  return (
    <div className="flex">
      <nav className="toc w-64 fixed right-8 top-32 bg-gray-50 p-4 rounded-lg shadow-md z-10">
        <h3 className="text-lg font-semibold mb-4">{t('appApi.develop.toc')}</h3>
        <ul className="space-y-2">
          {toc.map((item, index) => (
            <li key={index}>
              <a
                href={item.href}
                className="text-gray-600 hover:text-gray-900 hover:underline transition-colors duration-200"
              >
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <article className="prose prose-xl" >
        {(appDetail?.mode === 'chat' || appDetail?.mode === 'agent-chat') && (
          locale !== LanguagesSupported[1] ? <TemplateChatEn appDetail={appDetail} variables={variables} inputs={inputs} /> : <TemplateChatZh appDetail={appDetail} variables={variables} inputs={inputs} />
        )}
        {appDetail?.mode === 'advanced-chat' && (
          locale !== LanguagesSupported[1] ? <TemplateAdvancedChatEn appDetail={appDetail} variables={variables} inputs={inputs} /> : <TemplateAdvancedChatZh appDetail={appDetail} variables={variables} inputs={inputs} />
        )}
        {appDetail?.mode === 'workflow' && (
          locale !== LanguagesSupported[1] ? <TemplateWorkflowEn appDetail={appDetail} variables={variables} inputs={inputs} /> : <TemplateWorkflowZh appDetail={appDetail} variables={variables} inputs={inputs} />
        )}
        {appDetail?.mode === 'completion' && (
          locale !== LanguagesSupported[1] ? <TemplateEn appDetail={appDetail} variables={variables} inputs={inputs} /> : <TemplateZh appDetail={appDetail} variables={variables} inputs={inputs} />
        )}
      </article>
    </div>
  )
}

export default Doc
