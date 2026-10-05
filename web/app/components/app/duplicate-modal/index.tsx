'use client'
import type { AppDetailWithSite, CopyAppPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { IconPickerInputValue, IconPickerValue } from '@/app/components/base/icon-picker'
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
import { IconPickerDialog } from '@/app/components/base/icon-picker'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { toast } from '@/app/notifications'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'

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

  const [selectedIcon, setSelectedIcon] = useState<IconPickerValue | null>(null)
  const pickerValue: IconPickerInputValue | undefined =
    selectedIcon ??
    (icon_type === 'image' && icon
      ? { type: 'image', url: icon_url ?? '', fileId: icon }
      : icon_type === 'emoji' && icon
        ? { type: 'emoji', icon, background: icon_background }
        : icon_type === 'link' && icon
          ? { type: 'link', url: icon }
          : undefined)
  const currentIcon = selectedIcon
    ? {
        icon_type: selectedIcon.type,
        icon: selectedIcon.type === 'emoji' ? selectedIcon.icon : selectedIcon.fileId,
        icon_background: selectedIcon.type === 'emoji' ? selectedIcon.background : undefined,
        icon_url: selectedIcon.type === 'image' ? selectedIcon.url : undefined,
      }
    : { icon_type, icon, icon_background, icon_url }

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
      icon_type: currentIcon.icon_type,
      icon: currentIcon.icon,
      icon_background: currentIcon.icon_background,
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
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
                <IconPickerDialog
                  value={pickerValue}
                  onConfirm={setSelectedIcon}
                  size="large"
                  className="col-start-1 row-start-2"
                  aria-label={`${t(($) => $['operation.edit'], { ns: 'common' })} ${t(($) => $['appCustomize.subTitle'], { ns: 'explore' })}`}
                />
                <Field name="name" className="contents">
                  <FieldLabel className="col-span-2 row-start-1 system-md-medium">
                    {t(($) => $['appCustomize.subTitle'], { ns: 'explore' })}
                  </FieldLabel>
                  <Input
                    autoComplete="off"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="col-start-2 row-start-2 h-10"
                    placeholder={t(($) => $['placeholder.input'], { ns: 'common' }) || ''}
                  />
                </Field>
              </div>
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
              <Button className="w-24" onClick={onHide}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default DuplicateAppModal
