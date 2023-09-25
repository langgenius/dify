'use client'

import { useContext } from 'use-context-selector'
import TemplateEn from './template/template.en.mdx'
import TemplateZh from './template/template.zh.mdx'
import I18n from '@/context/i18n'

const Doc = () => {
  const { locale } = useContext(I18n)

  return (
    <article className='mx-12 pt-16 bg-white rounded-t-xl prose prose-xl'>
      {
        locale === 'en'
          ? <TemplateEn />
          : <TemplateZh />
      }
    </article>
  )
}

export default Doc
