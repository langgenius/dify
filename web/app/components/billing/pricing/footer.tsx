import type { Locale } from '@/i18n/locale'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import Link from '@/next/link'
import styles from './pricing.module.css'

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
    <div className={styles.footer}>
      <div
        data-category={category}
        className="flex min-w-0 grow flex-wrap items-center justify-between gap-4"
      >
        {category === 'cloud' && (
          <div className="flex min-w-0 flex-1 flex-col text-text-tertiary">
            <span className="system-md-regular">
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
          <img src="/pricing/imgArrowRightUpLine.svg" alt="" width={24} height={24} />
        </span>
      </div>
    </div>
  )
}
