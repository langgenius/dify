'use client'

import type { CreateAppPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { StarterAppMode } from './chat-input-starter'
import type { CreateAppTypeDropdownProps } from './create-app-type-dropdown'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { difyBuilderPendingCreationAtom } from '@/app/components/workflow-app/components/dify-builder/creation'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import dynamic from '@/next/dynamic'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getRedirection } from '@/utils/app-redirection'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { hasPermission } from '@/utils/permission'
import { CreateAppTypeDropdown } from './create-app-type-dropdown'

const ChatInputStarter = dynamic(() => import('./chat-input-starter'), { ssr: false })

export function CreateAppEntry(
  props: Omit<CreateAppTypeDropdownProps, 'onSelectType' | 'disabled' | 'loading'>,
) {
  const { t } = useTranslation(['app', 'billing', 'common'])
  const { push } = useRouter()
  const { data: features } = useQuery(consoleQuery.features.get.queryOptions())
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const setPendingCreation = useSetAtom(difyBuilderPendingCreationAtom)
  const { mutateAsync: createApp } = useMutation(consoleQuery.apps.post.mutationOptions())
  const [starter, setStarter] = useState<{ mode: StarterAppMode; open: boolean } | null>(null)
  const [showQuota, setShowQuota] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const creatingRef = useRef(false)
  const [error, setError] = useState('')
  const appQuota = features?.apps
  const isCloud = systemFeatures.deployment_edition === 'CLOUD'
  const isAppsFull = isCloud && !!appQuota && appQuota.limit > 0 && appQuota.size >= appQuota.limit
  const unavailable = !canCreateApp || !features || (isCloud && !appQuota)

  const create = async (mode: CreateAppPayload['mode'], prompt?: string) => {
    if (unavailable || isAppsFull || creatingRef.current) return
    const goal = prompt?.trim()
    if (prompt !== undefined && (!goal || !features.dify_builder_enabled)) return
    creatingRef.current = true
    setIsCreating(true)
    setError('')
    try {
      const app = await createApp({
        body: {
          mode,
          ...(goal ? { prompt: goal } : { name: t(($) => $['newApp.untitled'], { ns: 'app' }) }),
          description: '',
          icon_type: 'emoji',
          icon: '\u{1F916}',
          icon_background: '#FFEAD5',
        },
      })
      try {
        void trackCreateApp({ source: 'studio_blank', appMode: mode })
      } catch {
        // Analytics must not prevent navigation after creation succeeds.
      }
      if (goal) setPendingCreation({ appId: app.id, prompt: goal, deriveAppName: true })
      setStarter((current) => current && { ...current, open: false })
      toast.success(t(($) => $['newApp.appCreated'], { ns: 'app' }))
      getRedirection(app, push, {
        currentUserId,
        resourceMaintainer: app.maintainer,
        workspacePermissionKeys,
        isRbacEnabled: systemFeatures.rbac_enabled,
      })
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : t(($) => $['newApp.appCreateFailed'], { ns: 'app' })
      setError(message)
      if (!starter?.open) toast.error(message)
    } finally {
      creatingRef.current = false
      setIsCreating(false)
    }
  }

  return (
    <>
      <CreateAppTypeDropdown
        {...props}
        disabled={unavailable}
        loading={isCreating}
        onSelectType={(mode) => {
          if (unavailable || creatingRef.current) return
          setError('')
          if (isAppsFull) {
            setShowQuota(true)
            return
          }
          if (features.dify_builder_enabled && (mode === 'workflow' || mode === 'advanced-chat')) {
            setStarter({ mode, open: true })
            return
          }
          void create(mode)
        }}
      />
      {starter && (
        <ChatInputStarter
          show={starter.open && !!features?.dify_builder_enabled && canCreateApp}
          mode={starter.mode}
          onClose={() => {
            if (!creatingRef.current)
              setStarter((current) => current && { ...current, open: false })
          }}
          onCreate={(prompt) => {
            void create(starter.mode, prompt)
          }}
          onCreateTemplate={
            props.onCreateTemplate &&
            (() => {
              setStarter((current) => current && { ...current, open: false })
              props.onCreateTemplate?.()
            })
          }
          isCreating={isCreating}
          disabled={unavailable || isAppsFull}
          isAppsFull={isAppsFull}
          error={error}
        />
      )}
      <Dialog open={showQuota} onOpenChange={setShowQuota}>
        <DialogContent className="pt-12">
          <DialogTitle className="sr-only">
            {t(($) => $['apps.fullTip1'], { ns: 'billing' })}
          </DialogTitle>
          <AppsFull loc="app-create" />
          <DialogClose
            render={
              <IconButton
                variant="ghost"
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                className="absolute top-3 right-3"
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
