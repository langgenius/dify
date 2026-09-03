'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { useKnowledgeSpace } from '../../space/context'
import { documentDetailTitleAtom } from './state/queries'

export function useDocumentDetailTitle() {
  const { t } = useTranslation('knowledgeSpace')
  const documentTitle = useAtomValue(documentDetailTitleAtom)
  const { space } = useKnowledgeSpace()
  const resolvedDocumentTitle = documentTitle ?? t(($) => $.documents)
  const knowledgeSpaceTitle =
    space.technical_summary?.name ?? t(($) => $.knowledge, { ns: 'dataset' })

  useDocumentTitle(`${resolvedDocumentTitle} · ${knowledgeSpaceTitle}`)
}
