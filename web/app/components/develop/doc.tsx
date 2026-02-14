'use client'
import type { ComponentType } from 'react'
import type { App, AppSSO } from '@/types/app'
import { useMemo } from 'react'
import { useLocale } from '@/context/i18n'
import useTheme from '@/hooks/use-theme'
import { getDocLanguage } from '@/i18n-config/language'
import { AppModeEnum, Theme } from '@/types/app'
import { cn } from '@/utils/classnames'
import { useDocToc } from './hooks/use-doc-toc'
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
import TocPanel from './toc-panel'

type AppDetail = App & Partial<AppSSO>
type PromptVariable = { key: string, name: string }

type IDocProps = {
  appDetail: AppDetail
}

// Shared props shape for all MDX template components
type TemplateProps = {
  appDetail: AppDetail
  variables: PromptVariable[]
  inputs: Record<string, string>
}

// Lookup table: [appMode][docLanguage] → template component
// MDX components accept arbitrary props at runtime but expose a narrow static type,
// so we assert the map type to allow passing TemplateProps when rendering.
const TEMPLATE_MAP = {
  [AppModeEnum.CHAT]: { zh: TemplateChatZh, ja: TemplateChatJa, en: TemplateChatEn },
  [AppModeEnum.AGENT_CHAT]: { zh: TemplateChatZh, ja: TemplateChatJa, en: TemplateChatEn },
  [AppModeEnum.ADVANCED_CHAT]: { zh: TemplateAdvancedChatZh, ja: TemplateAdvancedChatJa, en: TemplateAdvancedChatEn },
  [AppModeEnum.WORKFLOW]: { zh: TemplateWorkflowZh, ja: TemplateWorkflowJa, en: TemplateWorkflowEn },
  [AppModeEnum.COMPLETION]: { zh: TemplateZh, ja: TemplateJa, en: TemplateEn },
} as Record<string, Record<string, ComponentType<TemplateProps>>>

const resolveTemplate = (mode: string | undefined, locale: string): ComponentType<TemplateProps> | null => {
  if (!mode)
    return null
  const langTemplates = TEMPLATE_MAP[mode]
  if (!langTemplates)
    return null
  const docLang = getDocLanguage(locale)
  return langTemplates[docLang] ?? langTemplates.en ?? null
}

const Doc = ({ appDetail }: IDocProps) => {
  const locale = useLocale()
  const { theme } = useTheme()
  const { toc, isTocExpanded, setIsTocExpanded, activeSection, handleTocClick } = useDocToc({ appDetail, locale })

  // model_config.configs.prompt_variables exists in the raw API response but is not modeled in ModelConfig type
  const variables: PromptVariable[] = (
    appDetail?.model_config as unknown as Record<string, Record<string, PromptVariable[]>> | undefined
  )?.configs?.prompt_variables ?? []
  const inputs = variables.reduce<Record<string, string>>((res, variable) => {
    res[variable.key] = variable.name || ''
    return res
  }, {})

  const TemplateComponent = useMemo(
    () => resolveTemplate(appDetail?.mode, locale),
    [appDetail?.mode, locale],
  )

  return (
    <div className="flex">
      <div className={`fixed right-20 top-32 z-10 transition-all duration-150 ease-out ${isTocExpanded ? 'w-[280px]' : 'w-11'}`}>
        <TocPanel
          toc={toc}
          activeSection={activeSection}
          isTocExpanded={isTocExpanded}
          onToggle={setIsTocExpanded}
          onItemClick={handleTocClick}
        />
      </div>
      <article className={cn('prose-xl prose', theme === Theme.dark && 'prose-invert')}>
        {TemplateComponent && <TemplateComponent appDetail={appDetail} variables={variables} inputs={inputs} />}
      </article>
    </div>
  )
}

export default Doc
