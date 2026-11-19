'use client'

import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'

export function ArchivedLogsNotice() {
  const { t } = useTranslation(['appLog'])
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.billing.subscription.plan,
    }),
  )
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)

  if (
    deploymentEdition !== 'CLOUD' ||
    !isCurrentWorkspaceManager ||
    (plan !== 'professional' && plan !== 'team')
  )
    return null

  return (
    <Alert type="info" className="mb-3 shrink-0">
      <AlertTitle>{t(($) => $['archives.notice.description'], { ns: 'appLog' })}</AlertTitle>
      <AlertActions>
        <Button
          size="small"
          variant="primary"
          onClick={() => setSettingsDestination('workflow-log-archives')}
        >
          {t(($) => $['archives.notice.action'], { ns: 'appLog' })}
        </Button>
      </AlertActions>
    </Alert>
  )
}
