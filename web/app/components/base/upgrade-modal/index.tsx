'use client'

import type { ComponentType, FC, ReactNode, SVGProps } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/app/components/base/ui/dialog'
import { cn } from '@/utils/classnames'
import styles from './style.module.css'

type Props = {
  Icon?: ComponentType<SVGProps<SVGSVGElement>>
  title: string
  description: string
  extraInfo?: ReactNode
  footer?: ReactNode
  show: boolean
}

const UpgradeModalBase: FC<Props> = ({
  Icon,
  title,
  description,
  extraInfo,
  footer,
  show,
}) => {
  return (
    <Dialog open={show} disablePointerDismissal>
      <DialogContent className={cn(styles.surface, 'w-[580px] rounded-2xl !p-0')}>
        <div className="relative">
          <div
            aria-hidden
            className={`${styles.heroOverlay} pointer-events-none absolute inset-0`}
          />
          <div className="px-8 pt-8">
            {Icon && (
              <div className={`${styles.icon} flex size-12 items-center justify-center rounded-xl shadow-lg backdrop-blur-[5px]`}>
                <Icon className="size-6 text-text-primary-on-surface" />
              </div>
            )}
            <div className="mt-6 space-y-2">
              <DialogTitle className={cn(styles.highlight, 'title-3xl-semi-bold')}>
                {title}
              </DialogTitle>
              <div className="text-text-tertiary system-md-regular">
                {description}
              </div>
            </div>
            {extraInfo}
          </div>
        </div>

        {!!footer && (
          <div className="mb-8 mt-10 flex justify-end space-x-2 px-8">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default UpgradeModalBase
