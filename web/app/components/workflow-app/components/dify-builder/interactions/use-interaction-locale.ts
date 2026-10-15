import { use } from 'react'
import { useLocale } from '#i18n'
import { DifyBuilderLocaleContext } from './locale-context'

export const useDifyBuilderInteractionLocale = () => {
  const accountLocale = useLocale()
  return use(DifyBuilderLocaleContext) ?? accountLocale
}
