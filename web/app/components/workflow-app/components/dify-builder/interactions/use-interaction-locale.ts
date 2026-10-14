import { useAtomValue } from 'jotai'
import { useLocale } from '#i18n'
import { difyBuilderExecutionProgressAtom, difyBuilderReplyLanguageAtom } from '../session/state'
import { resolveInteractionLocale } from './locale'

export const useDifyBuilderInteractionLocale = () => {
  const accountLocale = useLocale()
  const replyLanguage = useAtomValue(difyBuilderReplyLanguageAtom)
  const progress = useAtomValue(difyBuilderExecutionProgressAtom)
  return resolveInteractionLocale(progress?.replyLanguage || replyLanguage, accountLocale)
}
