import type { SiteInfo } from '@/models/share'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent } from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import AppIcon from '@/app/components/base/app-icon'
import { appDefaultIconBackground } from '@/config'

type Props = {
  data?: SiteInfo
  isShow: boolean
  onClose: () => void
}

const InfoModal = ({
  isShow,
  onClose,
  data,
}: Props) => {
  return (
    <Dialog
      open={isShow}
      onOpenChange={(open) => {
        if (!open)
          onClose()
      }}
    >
      <DialogContent className="w-full max-w-[400px] min-w-[400px] overflow-hidden! border-none p-0! text-left align-middle">
        <DialogCloseButton />

        <div className={cn('flex flex-col items-center gap-4 px-4 pt-10 pb-8')}>
          <AppIcon
            size="xxl"
            iconType={data?.icon_type}
            icon={data?.icon}
            background={data?.icon_background || appDefaultIconBackground}
            imageUrl={data?.icon_url}
          />
          <div className="system-xl-semibold text-text-secondary">{data?.title}</div>
          <div className="system-xs-regular text-text-tertiary">
            {/* copyright */}
            {data?.copyright && (
              <div>
                ©
                {(new Date()).getFullYear()}
                {' '}
                {data?.copyright}
              </div>
            )}
            {data?.custom_disclaimer && (
              <div className="mt-2">{data.custom_disclaimer}</div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default InfoModal
