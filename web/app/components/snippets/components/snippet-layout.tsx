'use client'

import type { FC, ReactNode } from 'react'
import type { NavIcon } from '@/app/components/app-sidebar/nav-link'
import type { SnippetDetail, SnippetSection } from '@/models/snippet'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import AppSideBar from '@/app/components/app-sidebar'
import NavLink from '@/app/components/app-sidebar/nav-link'
import SnippetInfo from '@/app/components/app-sidebar/snippet-info'
import { useStore as useAppStore } from '@/app/components/app/store'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useDocumentTitle from '@/hooks/use-document-title'

type SnippetLayoutProps = {
  children: ReactNode
  section: SnippetSection
  snippet: SnippetDetail
  snippetId: string
}

const SidebarCssIcon: FC<{ iconClassName: string, className?: string }> = ({ iconClassName, className }) => {
  return <span aria-hidden className={cn(iconClassName, className)} />
}

const OrchestrateIcon = ({ className }: { className?: string }) => {
  return <SidebarCssIcon iconClassName="i-ri-terminal-window-line" className={className} />
}

const OrchestrateSelectedIcon = ({ className }: { className?: string }) => {
  return <SidebarCssIcon iconClassName="i-ri-terminal-window-fill" className={className} />
}

const EvaluationIcon = ({ className }: { className?: string }) => {
  return <SidebarCssIcon iconClassName="i-custom-vender-line-others-evaluation" className={className} />
}

const EvaluationSelectedIcon = ({ className }: { className?: string }) => {
  return <SidebarCssIcon iconClassName="i-custom-vender-line-others-evaluation" className={className} />
}

const ORCHESTRATE_ICONS: { normal: NavIcon, selected: NavIcon } = {
  normal: OrchestrateIcon,
  selected: OrchestrateSelectedIcon,
}

const EVALUATION_ICONS: { normal: NavIcon, selected: NavIcon } = {
  normal: EvaluationIcon,
  selected: EvaluationSelectedIcon,
}

const SnippetLayout = ({
  children,
  section,
  snippet,
  snippetId,
}: SnippetLayoutProps) => {
  const { t } = useTranslation('snippet')
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const setAppSidebarExpand = useAppStore(state => state.setAppSidebarExpand)

  useDocumentTitle(snippet.name || t('typeLabel'))

  useEffect(() => {
    const localeMode = localStorage.getItem('app-detail-collapse-or-expand') || 'expand'
    const mode = isMobile ? 'collapse' : 'expand'
    setAppSidebarExpand(isMobile ? mode : localeMode)
  }, [isMobile, setAppSidebarExpand])

  return (
    <div className="relative flex h-full overflow-hidden bg-background-body">
      <AppSideBar
        navigation={[]}
        renderHeader={mode => <SnippetInfo expand={mode === 'expand'} snippet={snippet} />}
        renderNavigation={mode => (
          <>
            <NavLink
              mode={mode}
              name={t('sectionOrchestrate')}
              iconMap={ORCHESTRATE_ICONS}
              href={`/snippets/${snippetId}/orchestrate`}
              active={section === 'orchestrate'}
            />
            <NavLink
              mode={mode}
              name={t('sectionEvaluation')}
              iconMap={EVALUATION_ICONS}
              href={`/snippets/${snippetId}/evaluation`}
              active={section === 'evaluation'}
              disabled={!snippet.is_published}
            />
          </>
        )}
      />

      <div className="relative min-h-0 min-w-0 grow overflow-hidden">
        <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  )
}

export default SnippetLayout
