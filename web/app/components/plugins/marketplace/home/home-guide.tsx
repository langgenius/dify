'use client'

import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useTranslation } from '#i18n'
import {
  SubmitRequestDropdown,
  SubmitRequestDropdownMenu,
} from '@/app/components/plugins/plugin-page/nav-operations'
import { defaultDocBaseUrl } from '@/context/i18n'
import { getDocLanguage } from '@/i18n-config/language'

function MarketplaceGuide() {
  const { i18n } = useTranslation()
  const docLanguage = getDocLanguage(i18n.language)
  const docLink = (path: DocPathWithoutLang) => `${defaultDocBaseUrl}/${docLanguage}${path}`

  return <SubmitRequestDropdownMenu dividerAfterFirst docLink={docLink} />
}

export default function HomeGuide({ isMarketplacePlatform }: { isMarketplacePlatform: boolean }) {
  // Standalone Marketplace cannot call useDocLink(): it reads the console-only
  // systemFeatures suspense query and crashes SSR. The dropdown paths have no
  // product-specific variants, so composing the URL from the locale matches.
  return isMarketplacePlatform ? <MarketplaceGuide /> : <SubmitRequestDropdown dividerAfterFirst />
}
