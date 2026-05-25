'use client'

import type { ComponentType, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import styles from './style.module.css'

type UpgradeModalClassNames = {
  content?: string
  heroOverlay?: string
  body?: string
  icon?: string
  copy?: string
  title?: string
  description?: string
  footer?: string
}

type UpgradeModalProps = {
  open: boolean
  onOpenChange?: (open: boolean) => void
  Icon?: ComponentType<{ className?: string }>
  title: ReactNode
  description: ReactNode
  extraInfo?: ReactNode
  footer: ReactNode
  classNames?: UpgradeModalClassNames
}

export function UpgradeModal({
  open,
  onOpenChange,
  Icon,
  title,
  description,
  extraInfo,
  footer,
  classNames,
}: UpgradeModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className={cn(styles.surface, 'w-[580px] max-w-[480px] overflow-hidden rounded-2xl p-0', classNames?.content)}>
        <div className="relative">
          <div
            aria-hidden
            className={cn(styles.heroOverlay, 'pointer-events-none absolute inset-0', classNames?.heroOverlay)}
          />
          <div className={cn('px-8 pt-8', classNames?.body)}>
            {Icon && (
              <div className={cn(styles.icon, 'flex size-12 items-center justify-center rounded-xl shadow-lg backdrop-blur-[5px]', classNames?.icon)}>
                <Icon className="size-6 text-text-primary-on-surface" />
              </div>
            )}
            <div className={cn('mt-6 space-y-2', classNames?.copy)}>
              <DialogTitle className={cn(styles.highlight, 'title-3xl-semi-bold', classNames?.title)}>
                {title}
              </DialogTitle>
              <DialogDescription className={cn('system-md-regular text-text-tertiary', classNames?.description)}>
                {description}
              </DialogDescription>
            </div>
            {extraInfo}
          </div>
        </div>

        <div className={cn('mt-10 mb-8 flex justify-end space-x-2 px-8', classNames?.footer)}>
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  )
}
