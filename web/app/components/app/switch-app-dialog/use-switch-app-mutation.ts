import type { ConvertToWorkflowPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { SwitchAppSource } from './index'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getRedirection } from '@/utils/app-redirection'
import { getErrorMessage } from '@/utils/error-message'

type SwitchAppVariables = {
  sourceApp: SwitchAppSource
  body: ConvertToWorkflowPayload
  removeOriginal: boolean
}

export function useSwitchAppMutation() {
  const { t } = useTranslation(['app'])
  const { push, replace } = useRouter()
  const { data: isRbacEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (data) => data.rbac_enabled,
  })
  const conversion = useMutation(
    consoleQuery.apps.byAppId.convertToWorkflow.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const deletion = useMutation(
    consoleQuery.apps.byAppId.delete.mutationOptions({
      meta: { errorToast: false },
    }),
  )

  return {
    isPending: conversion.isPending || deletion.isPending,
    reset: () => {
      conversion.reset()
      deletion.reset()
    },
    mutate: (
      { sourceApp, body, removeOriginal }: SwitchAppVariables,
      { onSuccess }: { onSuccess: () => void },
    ) =>
      conversion.mutate(
        { params: { app_id: sourceApp.id }, body },
        {
          onError: (error) =>
            toast.error(
              getErrorMessage(error) ?? t(($) => $['newApp.appCreateFailed'], { ns: 'app' }),
            ),
          onSuccess: ({ new_app_id, permission_keys }) => {
            const finish = (removed: boolean) => {
              onSuccess()
              getRedirection(
                {
                  id: new_app_id,
                  mode: sourceApp.mode === 'completion' ? 'workflow' : 'advanced-chat',
                  permission_keys,
                },
                removed ? replace : push,
                { isRbacEnabled },
              )
            }
            if (!removeOriginal) {
              finish(false)
              return
            }
            deletion.mutate(
              { params: { app_id: sourceApp.id } },
              {
                onSuccess: () => finish(true),
                onError: (error) => {
                  toast.error(getErrorMessage(error) ?? t(($) => $.appDeleteFailed, { ns: 'app' }))
                  finish(false)
                },
              },
            )
          },
        },
      ),
  }
}
