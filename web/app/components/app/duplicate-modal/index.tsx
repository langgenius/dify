'use client'
import type { AppIconType } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { useProviderContext } from '@/context/provider-context'
import AppIconPicker from '../../base/app-icon-picker'

export type DuplicateAppModalProps = {
  appName: string
  icon_type: AppIconType | null
  icon: string
  icon_background?: string | null
  icon_url?: string | null
  show: boolean
  onConfirm: (info: {
    name: string
    icon_type: AppIconType
    icon: string
    icon_background?: string | null
  }) => Promise<void>
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
  const { t } = useTranslation()

  const [name, setName] = React.useState(appName)

  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [appIcon, setAppIcon] = useState(
    icon_type === 'image'
      ? { type: 'image' as const, url: icon_url, fileId: icon }
      : { type: 'emoji' as const, icon, background: icon_background },
  )

  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = enableBilling && plan.usage.buildApps >= plan.total.buildApps

  const submit = () => {
    if (isAppsFull) return

    if (!name.trim()) {
      toast.error(t(($) => $['appCustomize.nameRequired'], { ns: 'explore' }))
      return
    }
    onConfirm({
      name,
      icon_type: appIcon.type,
      icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
      icon_background: appIcon.type === 'emoji' ? appIcon.background : undefined,
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
              <Field className="gap-2" name="name">
                <FieldLabel className="py-0 system-md-medium">
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
                      iconType={appIcon.type}
                      icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
                      background={appIcon.type === 'image' ? undefined : appIcon.background}
                      imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
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
              <Button type="submit" disabled={isAppsFull} className="ml-2 w-24" variant="primary">
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
            appIcon.type === 'emoji'
              ? { icon: appIcon.icon, background: appIcon.background }
              : undefined
          }
          onOpenChange={setShowAppIconPicker}
          onSelect={(payload) => {
            setAppIcon(payload)
          }}
        />
      )}
    </>
  )
}

export default DuplicateAppModal
