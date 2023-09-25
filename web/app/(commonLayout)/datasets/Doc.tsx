'use client'

import { useContext } from 'use-context-selector'
import TemplateEn from './template/template.en.mdx'
import TemplateZh from './template/template.zh.mdx'
import I18n from '@/context/i18n'

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
    <article className="prose prose-xl bg-white" >
      {
        locale === 'en'
          ? <TemplateEn appDetail={appDetail} variables={variables} inputs={inputs} />
          : <TemplateZh appDetail={appDetail} variables={variables} inputs={inputs} />
      }
    </article>
  )
}

export default Doc
