'use client'

import type { CreateAppPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactNode } from 'react'
import type { PromptAppMode } from './prompt-dialog'
import type { CreateAppTypeMenuProps } from './type-menu'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import dynamic from 'next/dynamic'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { difyBuilderPendingCreationAtom } from '@/features/dify-builder/creation'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getRedirection } from '@/utils/app-redirection'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { getErrorMessage } from '@/utils/error-message'
import { hasPermission } from '@/utils/permission'
import { CreateAppTypeMenu } from './type-menu'

const CreateAppPromptDialog = dynamic(() => import('./prompt-dialog'), { ssr: false })

type BlankAppMetadata = Pick<
  CreateAppPayload,
  'name' | 'description' | 'icon_type' | 'icon' | 'icon_background'
>

type AppCreationFlowProps = {
  children: (controls: {
    onSelectType: (mode: CreateAppPayload['mode']) => void
    onCreateBlank: (mode: CreateAppPayload['mode'], metadata: BlankAppMetadata) => void
    disabled: boolean
    loading: boolean
    error: string
  }) => ReactNode
  onCreateTemplate?: () => void
}

export function AppCreationFlow({ children, onCreateTemplate }: AppCreationFlowProps) {
  const { t } = useTranslation(['app', 'billing', 'common'])
  const { push } = useRouter()
  const { data: features, isError: isFeaturesError } = useQuery(
    consoleQuery.features.get.queryOptions(),
  )
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const setPendingCreation = useSetAtom(difyBuilderPendingCreationAtom)
  const { mutateAsync: createApp } = useMutation(
    consoleQuery.apps.post.mutationOptions({ context: { silent: true } }),
  )
  const [starter, setStarter] = useState<{ mode: PromptAppMode; open: boolean } | null>(null)
  const [showQuota, setShowQuota] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const creatingRef = useRef(false)
  const [error, setError] = useState('')
  const appQuota = features?.apps
  const isCloud = systemFeatures.deployment_edition === 'CLOUD'
  const isAppsFull = isCloud && !!appQuota && appQuota.limit > 0 && appQuota.size >= appQuota.limit
  const unavailable = !canCreateApp
  const isBuilderEnabled = !isFeaturesError && features?.dify_builder_enabled === true
  const isStarterOpen = !!(starter?.open && isBuilderEnabled && canCreateApp)

  const create = async (
    mode: CreateAppPayload['mode'],
    prompt?: string,
    metadata?: BlankAppMetadata,
  ) => {
    if (unavailable || isAppsFull || creatingRef.current) return
    const goal = prompt?.trim()
    if (prompt !== undefined && (!goal || !isBuilderEnabled)) return
    creatingRef.current = true
    setIsCreating(true)
    setError('')
    let created = false
    try {
      const app = await createApp({
        body: {
          mode,
          ...(goal ? { prompt: goal } : { name: t(($) => $['newApp.untitled'], { ns: 'app' }) }),
          description: '',
          icon_type: 'emoji',
          icon: '\u{1F916}',
          icon_background: '#FFEAD5',
          ...metadata,
        },
      })
      created = true
      try {
        const tracking = trackCreateApp({ source: 'studio_blank', appMode: mode })
        if (metadata) await tracking
      } catch {
        // Analytics must not prevent navigation after creation succeeds.
      }
      if (goal) setPendingCreation({ appId: app.id, prompt: goal, deriveAppName: true })
      setStarter((current) => current && { ...current, open: false })
      getRedirection(app, push, {
        currentUserId,
        resourceMaintainer: app.maintainer,
        workspacePermissionKeys,
        isRbacEnabled: systemFeatures.rbac_enabled,
      })
    } catch (cause) {
      const message = getErrorMessage(cause) || t(($) => $['newApp.appCreateFailed'], { ns: 'app' })
      setError(message)
    } finally {
      if (!metadata || !created) {
        creatingRef.current = false
        setIsCreating(false)
      }
    }
  }

  const onSelectType = (mode: CreateAppPayload['mode']) => {
    if (unavailable || creatingRef.current) return
    setError('')
    if (isAppsFull) {
      setShowQuota(true)
      return
    }
    if (isBuilderEnabled && (mode === 'workflow' || mode === 'advanced-chat')) {
      setStarter({ mode, open: true })
      return
    }
    void create(mode)
  }

  return (
    <>
      {children({
        onSelectType,
        onCreateBlank: (mode, metadata) => void create(mode, undefined, metadata),
        disabled: unavailable,
        loading: isCreating,
        error: isStarterOpen ? '' : error,
      })}
      {starter && (
        <CreateAppPromptDialog
          show={isStarterOpen}
          mode={starter.mode}
          onClose={() => {
            if (!creatingRef.current) {
              setError('')
              setStarter((current) => current && { ...current, open: false })
            }
          }}
          onCreate={(prompt) => {
            void create(starter.mode, prompt)
          }}
          onCreateTemplate={
            onCreateTemplate &&
            (() => {
              setError('')
              setStarter((current) => current && { ...current, open: false })
              onCreateTemplate()
            })
          }
          isCreating={isCreating}
          disabled={unavailable || isAppsFull}
          isAppsFull={isAppsFull}
          error={error}
        />
      )}
      <Dialog open={showQuota} onOpenChange={setShowQuota}>
        <DialogContent>
          <DialogTitle className="sr-only">
            {t(($) => $['apps.fullTip1'], { ns: 'billing' })}
          </DialogTitle>
          <div className="pt-12">
            <AppsFull loc="app-create" />
          </div>
          <DialogClose
            render={
              <IconButton
                variant="ghost"
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                className="absolute inset-e-3 top-3"
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

export function CreateAppEntry(
  props: Omit<CreateAppTypeMenuProps, 'onSelectType' | 'disabled' | 'loading'>,
) {
  return (
    <AppCreationFlow onCreateTemplate={props.onCreateTemplate}>
      {({ onSelectType, disabled, loading, error }) => (
        <div className="flex max-w-full min-w-0 flex-col items-end gap-2">
          <CreateAppTypeMenu
            {...props}
            disabled={disabled}
            loading={loading}
            onSelectType={onSelectType}
          />
          {error && (
            <p role="alert" className="max-w-80 system-sm-regular text-text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </AppCreationFlow>
  )
}
