import type { PropsWithChildren } from 'react'
import MarketplaceDocumentTitle from './document-title'

// This route layout must stay a Server Component. A client layout wrapping the
// marketplace page makes Flight double-resolve streamed children
// (`reason.enqueueModel`) when opening /marketplace from cloud.dify.dev.
export default function MarketplaceLayout({ children }: PropsWithChildren) {
  return (
    <>
      <MarketplaceDocumentTitle />
      {children}
    </>
  )
}
