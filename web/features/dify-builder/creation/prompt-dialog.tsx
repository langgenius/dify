'use client'

import type { BuilderCreationMode } from './pending-prompt'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { getCountQuota, isQuotaReached } from '@/app/components/billing/quota'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getRedirectionPath } from '@/utils/app-redirection'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { getErrorMessage } from '@/utils/error-message'
import { hasPermission } from '@/utils/permission'
import { useDifyBuilderEnabled } from '../use-enabled'
import { pendingBuilderPromptAtom } from './pending-prompt'

export default function BuilderCreationPromptDialog({
  mode,
  onClose,
}: {
  mode: BuilderCreationMode
  onClose: () => void
}) {
  const { t } = useTranslation(['app', 'common', 'difyBuilder'])
  const { push } = useRouter()
  const inputId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const creating = useRef(false)
  const [prompt, setPrompt] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')
  const setPendingPrompt = useSetAtom(pendingBuilderPromptAtom)
  const enabled = useDifyBuilderEnabled()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const { data: quota, isError: quotaError } = useQuery(
    consoleQuery.features.get.queryOptions({ select: (features) => getCountQuota(features.apps) }),
  )
  const { mutateAsync: createApp } = useMutation(
    consoleQuery.apps.post.mutationOptions({ meta: { errorToast: false } }),
  )
  const isFull = quota !== undefined && isQuotaReached(quota)
  const canCreate =
    enabled &&
    quota !== undefined &&
    !isFull &&
    hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const appTitle =
    mode === 'workflow'
      ? t(($) => $['types.workflow'], { ns: 'app' })
      : t(($) => $['types.advanced'], { ns: 'app' })

  const create = async () => {
    const goal = prompt.trim()
    if (!goal || !canCreate || creating.current) return
    creating.current = true
    setIsCreating(true)
    setError('')
    try {
      const app = await createApp({
        body: {
          mode,
          name: appTitle,
          description: '',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#FFEAD5',
        },
      })
      const destination = getRedirectionPath(app, {
        currentUserId,
        resourceMaintainer: app.maintainer,
        workspacePermissionKeys,
        isRbacEnabled: systemFeatures.rbac_enabled,
      })
      if (destination === `/app/${app.id}/workflow`)
        setPendingPrompt({ appId: app.id, prompt: goal })
      void Promise.resolve()
        .then(() => trackCreateApp({ source: 'studio_blank', appMode: mode }))
        .catch(() => {})
      if (destination === '/apps') onClose()
      else push(destination)
    } catch (cause) {
      creating.current = false
      setIsCreating(false)
      setError(getErrorMessage(cause) || t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !creating.current && onClose()}>
      <DialogContent initialFocus={inputRef} className="w-160 max-w-[calc(100vw-2rem)]">
        <form
          className="relative flex flex-col gap-4 p-6"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <div>
            <div className="flex items-center gap-2">
              <span aria-hidden className="builder-brand-mark size-6 shrink-0" />
              <DialogTitle>{t(($) => $.emptyBuildTitle, { ns: 'difyBuilder' })}</DialogTitle>
            </div>
            <DialogDescription>{appTitle}</DialogDescription>
          </div>
          <label htmlFor={inputId} className="sr-only">
            {t(($) => $.messagePlaceholder, { ns: 'difyBuilder' })}
          </label>
          <textarea
            id={inputId}
            ref={inputRef}
            required
            rows={5}
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            disabled={isCreating}
            placeholder={t(($) => $.messagePlaceholder, { ns: 'difyBuilder' })}
            className="min-h-28 w-full resize-y rounded-xl border border-components-chat-input-border bg-components-panel-bg p-3 text-sm text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          />
          {isFull && <AppsFull loc="app-create" />}
          {(error || quotaError) && (
            <p role="alert" className="system-sm-regular text-text-destructive">
              {error || t(($) => $['newApp.appCreateFailed'], { ns: 'app' })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="secondary" disabled={isCreating} />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              disabled={!canCreate || !prompt.trim()}
              loading={isCreating}
            >
              {t(($) => $['newApp.Create'], { ns: 'app' })}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
