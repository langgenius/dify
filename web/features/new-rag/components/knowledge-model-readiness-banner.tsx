'use client'

import type { KnowledgeModelCapability } from '../routes'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { usePathname, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { newKnowledgeSettingsReturnPath } from '../routes'
import {
  knowledgeModelReadinessActionClassName,
  KnowledgeModelReadinessNotice,
} from './knowledge-model-readiness-notice'

export function KnowledgeModelReadinessBanner({
  capability,
  className,
  knowledgeSpaceId,
}: {
  capability?: KnowledgeModelCapability
  className?: string
  knowledgeSpaceId: string
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const returnTo = `${pathname}${search ? `?${search}` : ''}`
  const query = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.settings.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
  )
  const readiness = query.data
  const configurationComplete =
    readiness?.configuration_state === 'active' ||
    readiness?.configuration_state === 'pending-validation'
  if (query.isPending || (!query.isError && configurationComplete)) return null

  const isFailure = query.isError || readiness?.configuration_state === 'validation-failed'
  const title = query.isError
    ? tCommon(($) => $['api.actionFailed'])
    : readiness?.configuration_state === 'validation-failed'
      ? tCommon(($) => $['api.actionFailed'])
      : t(($) => $['newKnowledge.overview.attention.modelReadiness.title'])
  const description = query.isError
    ? undefined
    : readiness?.active_profile_available
      ? t(($) => $['newKnowledge.overview.attention.modelReadiness.description'])
      : t(($) => $['newKnowledge.overview.attention.modelReadiness.profilesMissing'])

  return (
    <KnowledgeModelReadinessNotice
      action={
        query.isError ? (
          <Button size="small" onClick={() => void query.refetch()}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        ) : (
          <Link
            className={knowledgeModelReadinessActionClassName}
            href={newKnowledgeSettingsReturnPath(knowledgeSpaceId, { capability, returnTo })}
          >
            {t(($) => $['newKnowledge.overview.attention.action.configureModels'])}
          </Link>
        )
      }
      className={className}
      description={description}
      title={title}
      tone={isFailure ? 'destructive' : 'warning'}
    />
  )
}
