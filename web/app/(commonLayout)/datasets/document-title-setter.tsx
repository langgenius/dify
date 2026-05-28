'use client'

import type { Namespace } from '@/i18n-config/resources'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'

type DocumentTitleSetterProps = {
  i18nKey: string
  namespace: Namespace
}

export function DocumentTitleSetter({
  i18nKey,
  namespace,
}: DocumentTitleSetterProps) {
  const { t } = useTranslation()
  useDocumentTitle(t(i18nKey, { ns: namespace }))

  return null
}
