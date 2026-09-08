'use client'

import { DialogBackdrop, DialogPopup } from '@langgenius/dify-ui/dialog'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import * as React from 'react'
import { PricingContent } from './content'

export function PricingDialogContent() {
  return (
    <>
      <DialogBackdrop className="transition-none" />
      <DialogPopup className="fixed inset-0 size-full max-h-none max-w-none overflow-hidden rounded-none border-none bg-saas-background p-0 shadow-none transition-none data-ending-style:scale-100 data-ending-style:opacity-100 data-starting-style:scale-100 data-starting-style:opacity-100">
        <ScrollArea className="h-full w-full overflow-hidden">
          <ScrollAreaViewport tabIndex={-1} className="overscroll-contain">
            <ScrollAreaContent className="grid min-h-full min-w-300">
              <PricingContent />
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
          <ScrollAreaScrollbar orientation="horizontal">
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
          <ScrollAreaCorner className="bg-saas-background" />
        </ScrollArea>
      </DialogPopup>
    </>
  )
}
