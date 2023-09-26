'use client'

import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import TemplateEn from './template/template.en.mdx'
import TemplateZh from './template/template.zh.mdx'
import I18n from '@/context/i18n'

type DocProps = {
  apiBaseUrl: string
}
const Doc: FC<DocProps> = ({
  apiBaseUrl,
}) => {
  const { locale } = useContext(I18n)

  return (
    <article className='mx-12 pt-16 bg-white rounded-t-xl prose prose-xl'>
      {
        locale === 'en'
          ? <TemplateEn apiBaseUrl={apiBaseUrl} />
          : <TemplateZh apiBaseUrl={apiBaseUrl} />
      }
    </article>
  )
}

export default Doc
