export const MARKETPLACE_IMAGE_PREVIEW_MESSAGE = 'dify-marketplace:image-preview'

export type MarketplaceImagePreviewMessage = {
  type: typeof MARKETPLACE_IMAGE_PREVIEW_MESSAGE
  open: boolean
}

export function isMarketplaceImagePreviewMessage(
  data: unknown,
): data is MarketplaceImagePreviewMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    data.type === MARKETPLACE_IMAGE_PREVIEW_MESSAGE &&
    'open' in data &&
    typeof data.open === 'boolean'
  )
}
