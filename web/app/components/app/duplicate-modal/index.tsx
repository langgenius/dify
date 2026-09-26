'use client'
import type { AppDetailWithSite, CopyAppPayload } from '@dify/contracts/api/console/apps/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { toast } from '@/app/notifications'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import AppIconPicker from '../../base/app-icon-picker'

export type DuplicateAppModalProps = {
  appName: string
  icon_type: AppDetailWithSite['icon_type']
  icon: AppDetailWithSite['icon']
  icon_background?: string | null
  icon_url?: string | null
  show: boolean
  onConfirm: (info: CopyAppPayload) => Promise<void>
  onHide: () => void
}

const DuplicateAppModal = ({
  appName,
  icon_type,
  icon,
  icon_background,
  icon_url,
  show = false,
  onConfirm,
  onHide,
}: DuplicateAppModalProps) => {
  const { t } = useTranslation(['app', 'common', 'explore'])

  const [name, setName] = React.useState(appName)

  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [appIcon, setAppIcon] = useState(() => ({
    icon_type,
    icon,
    icon_background,
    icon_url,
  }))

  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: appQuota } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.apps,
    }),
  )
  const isAppQuotaUnavailable = deploymentEdition === 'CLOUD' && appQuota === undefined
  // A limit of 0 means unlimited.
  const isAppsFull =
    deploymentEdition === 'CLOUD' &&
    appQuota !== undefined &&
    appQuota.limit > 0 &&
    appQuota.size >= appQuota.limit

  const submit = () => {
    if (isAppQuotaUnavailable || isAppsFull) return

    if (!name.trim()) {
      toast.error(t(($) => $['appCustomize.nameRequired'], { ns: 'explore' }))
      return
    }
    onConfirm({
      name,
      icon_type: appIcon.icon_type,
      icon: appIcon.icon,
      icon_background: appIcon.icon_background,
    })
    onHide()
  }

  return (
    <>
      <Dialog
        open={show}
        onOpenChange={(open) => {
          if (!open) onHide()
        }}
      >
        <DialogContent className="w-full max-w-120! overflow-hidden! border-none px-8 text-left align-middle">
          <IconButton
            size="lg"
            className="absolute top-4 right-4"
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            onClick={onHide}
          >
            <span aria-hidden="true" className="i-ri-close-line size-4" />
          </IconButton>
          <DialogTitle className="relative mt-3 mb-9 text-xl leading-7.5 font-semibold text-text-primary">
            {t(($) => $.duplicateTitle, { ns: 'app' })}
          </DialogTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <div className="mb-9 system-sm-regular text-text-secondary">
              <Field name="name">
                <FieldLabel className="system-md-medium">
                  {t(($) => $['appCustomize.subTitle'], { ns: 'explore' })}
                </FieldLabel>
                <div className="flex items-center justify-between space-x-2">
                  <button
                    type="button"
                    aria-label={`${t(($) => $['operation.edit'], { ns: 'common' })} ${t(($) => $['appCustomize.subTitle'], { ns: 'explore' })}`}
                    onClick={() => {
                      setShowAppIconPicker(true)
                    }}
                    className="shrink-0 cursor-pointer rounded-[10px] focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                  >
                    <AppIcon
                      size="large"
                      iconType={appIcon.icon_type === 'link' ? 'image' : appIcon.icon_type}
                      icon={appIcon.icon ?? undefined}
                      background={appIcon.icon_background}
                      imageUrl={appIcon.icon_type === 'link' ? appIcon.icon : appIcon.icon_url}
                    />
                  </button>
                  <Input
                    autoComplete="off"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-10"
                    placeholder={t(($) => $['placeholder.input'], { ns: 'common' }) || ''}
                  />
                </div>
              </Field>
              {isAppsFull && <AppsFull className="mt-4" loc="app-duplicate-create" />}
            </div>
            <div className="flex flex-row-reverse">
              <Button
                type="submit"
                disabled={isAppQuotaUnavailable || isAppsFull}
                className="ml-2 w-24"
                variant="primary"
              >
                {t(($) => $.duplicate, { ns: 'app' })}
              </Button>
              <Button type="button" className="w-24" onClick={onHide}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {showAppIconPicker && (
        <AppIconPicker
          open={showAppIconPicker}
          initialEmoji={
            appIcon.icon_type === 'emoji' && appIcon.icon
              ? { icon: appIcon.icon, background: appIcon.icon_background }
              : undefined
          }
          onOpenChange={setShowAppIconPicker}
          onSelect={(payload) => {
            setAppIcon({
              icon_type: payload.type,
              icon: payload.type === 'image' ? payload.fileId : payload.icon,
              icon_background: payload.type === 'emoji' ? payload.background : undefined,
              icon_url: payload.type === 'image' ? payload.url : undefined,
            })
          }}
        />
      )}
    </>
  )
}

export default DuplicateAppModal
