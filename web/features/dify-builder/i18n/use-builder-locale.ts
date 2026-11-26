import { use } from 'react'
import { useLocale } from '#i18n'
import { DifyBuilderLocaleContext } from './locale-context'

export const useDifyBuilderLocale = () => {
  const accountLocale = useLocale()
  return use(DifyBuilderLocaleContext) ?? accountLocale
}
