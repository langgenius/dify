'use client'

import type { ReactNode } from 'react'
import { PopoverClose } from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'

type PluginSidecarPanelProps = {
  children: ReactNode
  footer?: ReactNode
  title: ReactNode
}

export function PluginSidecarPanel({ children, footer, title }: PluginSidecarPanelProps) {
  const { t } = useTranslation()

  return (
    <div className="flex w-[360px] flex-col items-start overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9">
      <div className="relative flex w-full shrink-0 flex-col gap-0.5 px-3 pt-3.5 pb-1">
        <div className="flex w-full shrink-0 items-start">
          <div className="flex min-w-0 flex-1 flex-col items-start pr-8 pl-1">
            <div className="w-full system-xl-semibold text-text-primary">{title}</div>
          </div>
        </div>
        <PopoverClose
          render={
            <button
              type="button"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              className="absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </button>
          }
        />
      </div>
      {children}
      {footer}
    </div>
  )
}
