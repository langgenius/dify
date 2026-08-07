'use client'
import type { FC } from 'react'
import type { PopupProps } from './config-popup'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { lazy, Suspense, useState } from 'react'
import Loading from '@/app/components/base/loading'

const ConfigPopup = lazy(() => import('./config-popup'))

type Props = Readonly<{
  readOnly: boolean
  className?: string
  hasConfigured: boolean
  children?: React.ReactNode
}> &
  PopupProps

const ConfigBtn: FC<Props> = ({ className, hasConfigured, children, ...popupProps }) => {
  const [open, setOpen] = useState(false)

  if (popupProps.readOnly && !hasConfigured) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<div className={cn('select-none', className)}>{children}</div>} />
      {open && (
        <PopoverContent
          placement="bottom-end"
          sideOffset={12}
          popupClassName="border-none bg-transparent shadow-none"
        >
          <Suspense
            fallback={
              <div className="w-105 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-4 shadow-xl">
                <Loading />
              </div>
            }
          >
            <ConfigPopup {...popupProps} />
          </Suspense>
        </PopoverContent>
      )}
    </Popover>
  )
}
export default React.memo(ConfigBtn)
