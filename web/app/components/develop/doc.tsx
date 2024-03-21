'use client'
import { useContext } from 'use-context-selector'
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

  const variables = appDetail?.model_config?.configs?.prompt_variables || []
  const inputs = variables.reduce((res: any, variable: any) => {
    res[variable.key] = variable.name || ''
    return res
  }, {})

  return (
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
  )
}

export default Doc
