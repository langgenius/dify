import type { RefObject } from 'react'
import type { ToolsContentInset } from '../content-inset'
import type { MarketplaceLinks } from '@/features/marketplace/links'
import Marketplace from '.'
import { useToolMarketplacePanel } from './use-tool-marketplace-panel'

type BuiltinMarketplacePanelProps = {
  marketplace: MarketplaceLinks
  containerRef: RefObject<HTMLDivElement | null>
  contentInset: ToolsContentInset
  keywords: string
  tagFilterValue: string[]
}

export function BuiltinMarketplacePanel({
  marketplace,
  containerRef,
  contentInset,
  keywords,
  tagFilterValue,
}: BuiltinMarketplacePanelProps) {
  const { isMarketplaceArrowVisible, marketplaceContext, showMarketplacePanel, toolListTailRef } =
    useToolMarketplacePanel({
      containerRef,
      keywords,
      tagFilterValue,
    })

  return (
    <>
      <div ref={toolListTailRef} />
      <Marketplace
        marketplace={marketplace}
        searchPluginText={keywords}
        filterPluginTags={tagFilterValue}
        isMarketplaceArrowVisible={isMarketplaceArrowVisible}
        showMarketplacePanel={showMarketplacePanel}
        marketplaceContext={marketplaceContext}
        contentInset={contentInset}
      />
    </>
  )
}
