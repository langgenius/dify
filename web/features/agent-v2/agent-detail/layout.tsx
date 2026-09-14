'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { getAgentDefaultSection, getAgentSectionAccess } from '@/features/agent-v2/acl'
import { useAgentPermissions } from '@/features/agent-v2/permissions'
import useDocumentTitle from '@/hooks/use-document-title'
import { usePathname, useRouter } from '@/next/navigation'

type AgentDetailLayoutProps = {
  agentId: string
  children: ReactNode
}

const isNotFoundResponse = (error: unknown) => error instanceof Response && error.status === 404

export function AgentDetailLayout({ agentId, children }: AgentDetailLayoutProps) {
  const { t } = useTranslation('agentV2')
  const pathname = usePathname()
  const router = useRouter()
  const { t: tCommon } = useTranslation('common')
  const { agentQuery, ...capabilities } = useAgentPermissions(agentId)
  const shouldRedirectToRoster = isNotFoundResponse(agentQuery.error)
  const section = pathname.endsWith('/access-config')
    ? 'access-config'
    : pathname.endsWith('/access')
      ? 'access'
      : pathname.endsWith('/logs')
        ? 'logs'
        : pathname.endsWith('/monitoring')
          ? 'monitoring'
          : 'configure'
  const sectionTitle = t(($) => $[`agentDetail.sections.${section}`])
  const agentTitle = agentQuery.data?.name ?? t(($) => $['agentDetail.documentTitle'])
  const canAccessSection = getAgentSectionAccess(capabilities)[section]
  const defaultSection = getAgentDefaultSection(capabilities)
  const redirectPath = shouldRedirectToRoster
    ? '/agents'
    : agentQuery.isSuccess && !canAccessSection
      ? defaultSection
        ? `/agents/${agentId}/${defaultSection}`
        : '/agents'
      : undefined

  useDocumentTitle(`${sectionTitle} · ${agentTitle}`)

  useEffect(() => {
    if (redirectPath) router.replace(redirectPath)
  }, [router, redirectPath])

  if (agentQuery.isPending) return <Loading />
  if (redirectPath) return null
  if (agentQuery.isError) {
    return (
      <div role="alert" className="flex h-full items-center justify-center gap-3">
        <span>{t(($) => $['roster.loadingError'])}</span>
        <Button onClick={() => void agentQuery.refetch()}>
          {tCommon(($) => $['operation.retry'])}
        </Button>
      </div>
    )
  }
  if (!canAccessSection) return null

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}
