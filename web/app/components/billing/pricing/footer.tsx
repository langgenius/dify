import type { Locale } from '@/i18n/locale'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import Link from '@/next/link'

const websiteLocalePaths: Partial<Record<Locale, string>> = {
  'zh-Hans': '/zh',
  'ja-JP': '/ja',
  'ko-KR': '/ko',
}

export function PricingFooter({ category }: { category: 'cloud' | 'self-hosted' }) {
  const locale = useLocale()
  const comparisonPage = category === 'cloud' ? 'dify-cloud' : 'dify-enterprise'
  const pricingPageURL = `https://dify.ai${websiteLocalePaths[locale] ?? ''}/pricing/${comparisonPage}#compare`
  const { t } = useTranslation(['billing'])

  return (
    <div className="flex min-h-16 w-full justify-center border-t border-divider-accent px-3 xl:px-10">
      <div
        data-category={category}
        className="flex max-w-[1680px] min-w-0 grow flex-col justify-end gap-6 border-x border-divider-accent p-3 data-[category=cloud]:justify-between xl:flex-row xl:p-6"
      >
        {category === 'cloud' && (
          <div className="flex min-w-0 flex-1 flex-col text-text-tertiary">
            <span className="system-xs-regular">
              {t(($) => $['plansCommon.taxTip'], { ns: 'billing' })}
            </span>
          </div>
        )}
        <span className="flex h-fit min-w-0 items-center gap-x-1 text-saas-dify-blue-accessible xl:shrink-0">
          <Link
            href={pricingPageURL}
            className="rounded-xs system-md-regular hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t(($) => $['plansCommon.comparePlanAndFeatures'], { ns: 'billing' })}
          </Link>
          <span aria-hidden="true" className="i-ri-arrow-right-up-line size-4" />
        </span>
      </div>
    </div>
  )
}
