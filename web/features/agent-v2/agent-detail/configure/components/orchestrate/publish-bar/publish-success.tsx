'use client'

import { buttonVariants } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getAgentDetailPath } from '@/features/agent-v2/agent-detail/routes'
import {
  getAgentWebAppUrl,
  useWebAppAccessPermission,
} from '@/features/agent-v2/agent-detail/web-app-access'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'

export function AgentPublishSuccess({
  agentId,
  kind,
  onDismiss,
  onAccessMethods,
}: {
  agentId: string
  kind: 'first' | 'update'
  onDismiss: () => void
  onAccessMethods: () => void
}) {
  const { t } = useTranslation('agentV2')
  const agentQuery = useQuery(
    consoleQuery.agent.byAgentId.get.queryOptions({
      input: { params: { agent_id: agentId } },
    }),
  )
  const agent = agentQuery.data
  const accessControl = useWebAppAccessPermission(agent)
  const webAppUrl =
    agentQuery.isSuccess &&
    agent?.access_ready &&
    agent.enable_site &&
    !accessControl.noAccessPermission
      ? getAgentWebAppUrl(agent)
      : undefined

  return (
    <div className="p-4">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-state-success-hover text-text-success"
        >
          <span className="i-ri-check-line size-4" />
        </span>
        <div role="status" className="min-w-0 flex-1">
          <p className="system-sm-semibold text-text-primary">
            {kind === 'first'
              ? t(($) => $['agentDetail.configure.publishSuccess.firstTitle'])
              : t(($) => $['agentDetail.configure.publishSuccess.updateTitle'])}
          </p>
          <p className="mt-0.5 system-xs-regular text-text-secondary">
            {!webAppUrl
              ? t(($) => $['agentDetail.configure.publishSuccess.accessDescription'])
              : kind === 'first'
                ? t(($) => $['agentDetail.configure.publishSuccess.firstDescription'])
                : t(($) => $['agentDetail.configure.publishSuccess.updateDescription'])}
          </p>
        </div>
        <IconButton
          size="lg"
          aria-label={t(($) => $['agentDetail.configure.publishSuccess.dismiss'])}
          onClick={onDismiss}
        >
          <span aria-hidden className="i-ri-close-line size-4" />
        </IconButton>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <Link
          href={getAgentDetailPath(agentId, 'access')}
          onClick={onAccessMethods}
          className={buttonVariants({ variant: 'secondary' })}
        >
          {t(($) => $['agentDetail.configure.publishSuccess.accessMethods'])}
        </Link>
        {webAppUrl && (
          <a
            href={webAppUrl}
            target="_blank"
            rel="noreferrer"
            onClick={onDismiss}
            className={buttonVariants({ variant: 'primary' })}
          >
            {t(($) => $['agentDetail.configure.publishSuccess.openWebApp'])}
            <span aria-hidden className="i-ri-external-link-line size-4 shrink-0" />
          </a>
        )}
      </div>
    </div>
  )
}
