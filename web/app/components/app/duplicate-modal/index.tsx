'use client'
import type { AppDetailWithSite, CopyAppPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { IconPickerInputValue, IconPickerValue } from '@/app/components/base/icon-picker'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Input } from '@langgenius/dify-ui/input'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconPicker,
  IconPickerContent,
  IconPickerIcon,
  IconPickerTrigger,
} from '@/app/components/base/icon-picker'
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
        <DialogContent className="w-120">
          <DialogHeader>
            <DialogTitle>{t(($) => $.duplicateTitle, { ns: 'app' })}</DialogTitle>
            <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
          </DialogHeader>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <DialogBody>
              <Fieldset>
                <FieldsetLegend className="system-md-medium">
                  {t(($) => $['appCustomize.subTitle'], { ns: 'explore' })}
                </FieldsetLegend>
                <div className="flex items-center justify-between space-x-2">
                  <IconPicker value={pickerValue} onValueChange={setSelectedIcon}>
                    <IconPickerTrigger
                      aria-label={t(($) => $['iconPicker.title'], { ns: 'app' })}
                      className="shrink-0 cursor-pointer rounded-[10px]"
                    >
                      <IconPickerIcon size="large" />
                    </IconPickerTrigger>
                    <IconPickerContent />
                  </IconPicker>
                  <Field name="name" className="grow">
                    <Input
                      aria-label={t(($) => $['newApp.name'], { ns: 'app' })}
                      autoComplete="off"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-10"
                      placeholder={t(($) => $['placeholder.input'], { ns: 'common' }) || ''}
                    />
                  </Field>
                </div>
              </Fieldset>
              {isAppsFull && <AppsFull className="mt-4" loc="app-duplicate-create" />}
            </DialogBody>
            <DialogFooter>
              <Button type="button" className="w-24" onClick={onHide}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
              <Button
                type="submit"
                disabled={isAppQuotaUnavailable || isAppsFull}
                className="w-24"
                variant="primary"
              >
                {t(($) => $.duplicate, { ns: 'app' })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default DuplicateAppModal
