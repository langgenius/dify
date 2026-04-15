import type { Category } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { CategoryEnum } from './types'

type FooterProps = {
  pricingPageURL: string
  currentCategory: Category
}

const Footer = ({
  pricingPageURL,
  currentCategory,
}: FooterProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-16 w-full justify-center border-t border-divider-accent px-10">
      <div className={cn('flex max-w-[1680px] grow border-x border-divider-accent p-6', currentCategory === CategoryEnum.CLOUD ? 'justify-between' : 'justify-end')}>
        {currentCategory === CategoryEnum.CLOUD && (
          <div className="flex flex-col text-text-tertiary">
            <span className="system-xs-regular">{t('plansCommon.taxTip', { ns: 'billing' })}</span>
            <span className="system-xs-regular">{t('plansCommon.taxTipSecond', { ns: 'billing' })}</span>
          </div>
        )}
        <span className="flex h-fit items-center gap-x-1 text-saas-dify-blue-accessible">
          <Link
            href={pricingPageURL}
            className="system-md-regular hover:underline focus-visible:underline focus-visible:outline-hidden"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('plansCommon.comparePlanAndFeatures', { ns: 'billing' })}
          </Link>
          <span aria-hidden="true" className="i-ri-arrow-right-up-line size-4" />
        </span>
      </div>
    </div>
  )
}

export default React.memo(Footer)
