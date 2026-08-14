'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from '#i18n'
import { defaultDocBaseUrl, getDocHomePath, useDocLink } from '@/context/i18n'
import { getDocLanguage } from '@/i18n-config/language'
import Link from '@/next/link'
import styles from './home-sticky.module.css'

function GuideLink({ href }: { href: string }) {
  const { t } = useTranslation('plugin')

  return (
    <Link href={href} target="_blank" rel="noopener noreferrer" className={styles.guide}>
      <Button variant="ghost" size="large" className="min-w-[94px] gap-0.5 px-3 text-text-primary">
        <span aria-hidden className="i-ri-map-2-line size-5" />
        <span className="px-1 system-md-medium">{t(($) => $['marketplace.home.guide'])}</span>
      </Button>
    </Link>
  )
}

function MarketplaceGuide() {
  const { i18n } = useTranslation()
  const docLanguage = getDocLanguage(i18n.language)
  return <GuideLink href={`${defaultDocBaseUrl}/${docLanguage}${getDocHomePath()}`} />
}

function DifyGuide() {
  const docLink = useDocLink()
  return <GuideLink href={docLink()} />
}

export default function HomeGuide({ isMarketplacePlatform }: { isMarketplacePlatform: boolean }) {
  return isMarketplacePlatform ? <MarketplaceGuide /> : <DifyGuide />
}
