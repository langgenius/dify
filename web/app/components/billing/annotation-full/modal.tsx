'use client'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import GridMask from '@/app/components/base/grid-mask'
import UpgradeBtn from '../upgrade-btn'
import s from './style.module.css'
import Usage from './usage'

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
}>
export const AnnotationFullModal = React.memo(({ open, onOpenChange }: Props) => {
  const { t } = useTranslation(['billing', 'common'])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full overflow-hidden! border-none p-0! text-left align-middle">
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              size="lg"
              className="absolute inset-e-6 top-6 z-10"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />

        <GridMask
          wrapperClassName="rounded-lg"
          canvasClassName="rounded-lg"
          gradientClassName="rounded-lg"
        >
          <div className="mt-6 flex cursor-pointer flex-col rounded-lg border-2 border-solid border-transparent px-7 py-6 shadow-md transition-all duration-200 ease-in-out">
            <div className="flex items-center justify-between">
              <DialogTitle className={cn(s.textGradient, 'text-[18px] leading-6.75 font-semibold')}>
                <span className="block">
                  {t(($) => $['annotatedResponse.fullTipLine1'], { ns: 'billing' })}
                </span>
                <span className="block">
                  {t(($) => $['annotatedResponse.fullTipLine2'], { ns: 'billing' })}
                </span>
              </DialogTitle>
            </div>
            <Usage className="mt-4" />
            <div className="mt-7 flex justify-end">
              <UpgradeBtn loc="annotation-create" />
            </div>
          </div>
        </GridMask>
      </DialogContent>
    </Dialog>
  )
})
