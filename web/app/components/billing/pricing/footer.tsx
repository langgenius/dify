import type { Locale } from '@/i18n/locale'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import Link from '@/next/link'

const websiteLocalePaths: Partial<Record<Locale, string>> = {
  'zh-Hans': '/zh',
  'ja-JP': '/ja',
  'ko-KR': '/ko',
}

export function PricingFooter() {
  const locale = useLocale()
  const pricingPageURL = `https://dify.ai${websiteLocalePaths[locale] ?? ''}/pricing/dify-cloud#compare`
  const { t } = useTranslation(['billing'])

  return (
    <div className="flex pt-6 font-[PricingInter,sans-serif] xl:px-6">
      <div className="flex min-w-0 grow flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col text-text-tertiary">
          <span className="system-md-regular">
            {t(($) => $['plansCommon.taxTip'], { ns: 'billing' })}
          </span>
        </div>
        <Link
          href={pricingPageURL}
          className="group flex h-fit min-w-0 items-center gap-x-1 rounded-xs system-md-regular text-text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid xl:shrink-0"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="group-hover:underline group-focus-visible:underline">
            {t(($) => $['plansCommon.comparePlanAndFeatures'], { ns: 'billing' })}
          </span>
          <span aria-hidden className="i-ri-arrow-right-up-line size-6 shrink-0" />
        </Link>
      </div>
    </div>
  )
}
