'use client'
import type { FC } from 'react'
import type { ToolWithProvider } from '../../../workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import * as React from 'react'
import MCPDetailContent from './content'

type Props = {
  detail?: ToolWithProvider
  onUpdate: () => void
  onHide: () => void
  isTriggerAuthorize: boolean
  onFirstCreate: () => void
}

const MCPDetailPanel: FC<Props> = ({
  detail,
  onUpdate,
  onHide,
  isTriggerAuthorize,
  onFirstCreate,
}) => {
  const handleUpdate = (isDelete = false) => {
    if (isDelete)
      onHide()
    onUpdate()
  }

  if (!detail)
    return null

  return (
    <Drawer
      open={!!detail}
      modal
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open)
          onHide()
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop className="bg-transparent" />
        <DrawerViewport>
          <DrawerPopup className={cn('justify-start bg-components-panel-bg! p-0! shadow-xl data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-[420px] data-[swipe-direction=right]:max-w-[420px] data-[swipe-direction=right]:rounded-2xl data-[swipe-direction=right]:border-[0.5px] data-[swipe-direction=right]:border-components-panel-border')}>
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              {detail && (
                <MCPDetailContent
                  detail={detail}
                  onHide={onHide}
                  onUpdate={handleUpdate}
                  isTriggerAuthorize={isTriggerAuthorize}
                  onFirstCreate={onFirstCreate}
                />
              )}
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}

export default MCPDetailPanel
