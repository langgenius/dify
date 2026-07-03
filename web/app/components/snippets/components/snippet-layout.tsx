'use client'

import type { ReactNode } from 'react'
import type { SnippetDetail, SnippetSection } from '@/models/snippet'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'

type SnippetLayoutProps = {
  children: ReactNode
  section: SnippetSection
  snippet?: SnippetDetail
  snippetId: string
}

const SnippetLayout = ({
  children,
  snippet,
}: SnippetLayoutProps) => {
  const { t } = useTranslation('snippet')

  useDocumentTitle(snippet?.name || t('typeLabel'))

  return (
    <div className="relative flex h-full min-h-0 min-w-0 overflow-hidden bg-background-body">
      <div className="relative min-h-0 min-w-0 grow overflow-hidden">
        <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  )
}

export default SnippetLayout
