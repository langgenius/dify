'use client'

import type { AccessChannels } from '@dify/contracts/enterprise/types.gen'
import { Switch, SwitchSkeleton } from '@langgenius/dify-ui/switch'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { deploymentRouteAppInstanceIdAtom } from '../../route-state'
import {
  developerApiSettingsAtom,
  developerApiSettingsIsErrorAtom,
  developerApiSettingsIsLoadingAtom,
} from './state'

function DeveloperApiSwitch({ checked, accessChannels, disabled }: {
  checked: boolean
  accessChannels?: AccessChannels
  disabled?: boolean
}) {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const toggleDeveloperAPI = useMutation(consoleQuery.enterprise.accessService.updateAccessChannels.mutationOptions())

  return (
    <Switch
      aria-label={t('access.api.developerTitle')}
      checked={checked}
      disabled={disabled || !appInstanceId}
      loading={toggleDeveloperAPI.isPending}
      onCheckedChange={(enabled) => {
        if (!appInstanceId)
          return

        toggleDeveloperAPI.mutate({
          params: { appInstanceId },
          body: {
            appInstanceId,
            webAppEnabled: accessChannels?.webAppEnabled ?? false,
            developerApiEnabled: enabled,
          },
        })
      }}
    />
  )
}

export function DeveloperApiHeaderSwitch() {
  const { t } = useTranslation('deployments')
  const developerApiSettings = useAtomValue(developerApiSettingsAtom)
  const isLoading = useAtomValue(developerApiSettingsIsLoadingAtom)
  const isError = useAtomValue(developerApiSettingsIsErrorAtom)
  const accessChannels = developerApiSettings?.accessChannels
  const apiEnabled = accessChannels?.developerApiEnabled ?? false

  if (isLoading)
    return <SwitchSkeleton />

  return (
    <div className="flex items-center gap-2">
      <span className="system-xs-medium text-text-tertiary">
        {apiEnabled ? t('overview.enabled') : t('overview.disabled')}
      </span>
      <DeveloperApiSwitch
        checked={apiEnabled}
        accessChannels={accessChannels}
        disabled={isError}
      />
    </div>
  )
}
