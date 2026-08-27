'use client'
import { Dialog, DialogClose, DialogContent } from '@langgenius/dify-ui/dialog'
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
import { useGetPricingPageLanguage } from '@/context/i18n'
import { PricingContent } from './content'

function Pricing({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation()
  const pricingPageLanguage = useGetPricingPageLanguage()
  const pricingPageURL = pricingPageLanguage
    ? `https://dify.ai/${pricingPageLanguage}/pricing#plans-and-features`
    : 'https://dify.ai/pricing#plans-and-features'

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent className="inset-0 size-full max-h-none max-w-none translate-0 overflow-hidden rounded-none border-none bg-saas-background p-0 shadow-none">
        <DialogClose
          render={
            <IconButton
              variant="secondary"
              size="xl"
              className="absolute inset-e-5.5 top-6 z-10 rounded-full"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            >
              <span aria-hidden="true" className="i-ri-close-line size-5" />
            </IconButton>
          }
        />
        <ScrollArea className="h-full w-full overflow-hidden">
          <ScrollAreaViewport className="overscroll-contain">
            <ScrollAreaContent className="min-h-full min-w-300">
              <PricingContent pricingPageURL={pricingPageURL} />
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
      </DialogContent>
    </Dialog>
  )
}

export default Pricing
