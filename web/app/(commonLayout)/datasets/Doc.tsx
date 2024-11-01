'use client'

import { type FC, useEffect } from 'react'
import { useContext } from 'use-context-selector'
import TemplateEn from './template/template.en.mdx'
import TemplateZh from './template/template.zh.mdx'
import I18n from '@/context/i18n'
import { LanguagesSupported } from '@/i18n/language'

type DocProps = {
  apiBaseUrl: string
}
const Doc: FC<DocProps> = ({
  apiBaseUrl,
}) => {
  const { locale } = useContext(I18n)

  useEffect(() => {
    const hash = location.hash
    if (hash)
      document.querySelector(hash)?.scrollIntoView()
  }, [])

  return (
    <article className='mx-1 px-4 sm:mx-12 pt-16 bg-white rounded-t-xl prose prose-xl'>
      {
        locale !== LanguagesSupported[1]
          ? <TemplateEn apiBaseUrl={apiBaseUrl} />
          : <TemplateZh apiBaseUrl={apiBaseUrl} />
      }
    </article>
  )
}

export default Doc
