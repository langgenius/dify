import type { SiteInfo } from '@/models/share'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { appDefaultIconBackground } from '@/config'

type AppInfoDialogProps = Readonly<{
  data?: SiteInfo
  open: boolean
  onOpenChange: (open: boolean) => void
}>

export function AppInfoDialog({ open, onOpenChange, data }: AppInfoDialogProps) {
  const { t } = useTranslation(['common'])
  const [currentYear] = useState(() => new Date().getFullYear())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-100 min-w-0 border-none p-0! text-left align-middle">
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              size="lg"
              className="absolute inset-e-6 top-6"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />

        <div className="flex flex-col items-center gap-4 px-4 pt-10 pb-8">
          <AppIcon
            size="xxl"
            iconType={data?.icon_type}
            icon={data?.icon}
            background={data?.icon_background || appDefaultIconBackground}
            imageUrl={data?.icon_url}
          />
          <div className="w-full text-center">
            <DialogTitle className="system-xl-semibold text-text-secondary">
              {data?.title || t(($) => $['userProfile.about'], { ns: 'common' })}
            </DialogTitle>
            {data?.description && (
              <DialogDescription className="mt-1 system-xl-medium wrap-break-word text-text-tertiary">
                {data.description}
              </DialogDescription>
            )}
          </div>
          <div className="system-xs-regular text-text-tertiary">
            {data?.copyright && (
              <div>
                Copyright © {currentYear} {data?.copyright}. All Rights Reserved.
              </div>
            )}
            {data?.custom_disclaimer && <div className="mt-2">{data.custom_disclaimer}</div>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
