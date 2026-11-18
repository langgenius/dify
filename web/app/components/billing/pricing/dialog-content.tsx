'use client'

import { DialogBackdrop, DialogClose, DialogPopup } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { PricingContent } from './content'

export function PricingDialogContent() {
  const { t } = useTranslation(['common'])

  return (
    <>
      <DialogBackdrop className="transition-none" />
      <DialogPopup className="fixed inset-0 size-full overflow-hidden bg-background-default transition-none data-ending-style:scale-100 data-ending-style:opacity-100 data-starting-style:scale-100 data-starting-style:opacity-100">
        <DialogClose
          render={
            <IconButton
              variant="secondary"
              size="xl"
              className="absolute end-5 top-6 z-1 rounded-full xl:end-[34px] xl:top-[45px]"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            >
              <span aria-hidden className="i-ri-close-line size-5" />
            </IconButton>
          }
        />
        <ScrollArea className="h-full w-full overflow-hidden">
          <ScrollAreaViewport tabIndex={-1} className="overscroll-contain">
            <ScrollAreaContent className="grid min-h-full" style={{ minWidth: 0 }}>
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
