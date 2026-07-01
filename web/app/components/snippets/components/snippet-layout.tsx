'use client'

import type { ReactNode } from 'react'
import type { SnippetDetail, SnippetSection } from '@/models/snippet'
import { useTranslation } from 'react-i18next'
import { DetailSidebarFrame } from '@/app/components/detail-sidebar'
import { MainContent } from '@/app/components/main-nav/skip-nav'
import useDocumentTitle from '@/hooks/use-document-title'
import { SnippetDetailSection } from './snippet-detail-section'
import SnippetDetailTop from './snippet-detail-top'

type SnippetLayoutProps = {
  children: ReactNode
  section: SnippetSection
  snippet: SnippetDetail
  snippetId: string
}

const SnippetLayout = ({
  children,
  snippet,
}: SnippetLayoutProps) => {
  const { t } = useTranslation('snippet')

  useDocumentTitle(snippet.name || t('typeLabel'))

  return (
    <div className="relative flex h-full min-w-0 overflow-hidden bg-background-body">
      <DetailSidebarFrame
        renderTop={({ expand, onToggle }) => (
          <SnippetDetailTop
            expand={expand}
            onToggle={onToggle}
          />
        )}
        renderSection={({ expand }) => <SnippetDetailSection expand={expand} />}
      />
      <MainContent>
        <div className="relative min-h-0 min-w-0 grow overflow-hidden">
          <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
            {children}
          </div>
        </div>
      </MainContent>
    </div>
  )
}

export default SnippetLayout
