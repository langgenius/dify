'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent } from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import GridMask from '@/app/components/base/grid-mask'
import UpgradeBtn from '../upgrade-btn'
import s from './style.module.css'
import Usage from './usage'

type Props = {
  show: boolean
  onHide: () => void
}
const AnnotationFullModal: FC<Props> = ({
  show,
  onHide,
}) => {
  const { t } = useTranslation()

  return (
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open)
          onHide()
      }}
    >
      <DialogContent className="w-full overflow-hidden! border-none p-0! text-left align-middle">
        <DialogCloseButton data-testid="modal-close-button" />

        <GridMask wrapperClassName="rounded-lg" canvasClassName="rounded-lg" gradientClassName="rounded-lg">
          <div className="mt-6 flex cursor-pointer flex-col rounded-lg border-2 border-solid border-transparent px-7 py-6 shadow-md transition-all duration-200 ease-in-out">
            <div className="flex items-center justify-between">
              <div className={cn(s.textGradient, 'text-[18px] leading-[27px] font-semibold')}>
                <div>{t('annotatedResponse.fullTipLine1', { ns: 'billing' })}</div>
                <div>{t('annotatedResponse.fullTipLine2', { ns: 'billing' })}</div>
              </div>

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
}
export default React.memo(AnnotationFullModal)
