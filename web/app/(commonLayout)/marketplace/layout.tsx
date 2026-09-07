import type { PropsWithChildren } from 'react'
import MarketplaceDocumentTitle from './document-title'

// Server layout: a client layout here Flight-double-resolves the page.
export default function MarketplaceLayout({ children }: PropsWithChildren) {
  return (
    <>
      <MarketplaceDocumentTitle />
      {children}
    </>
  )
}
