import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { RiArrowRightUpLine } from '@remixicon/react'
import { type Category, CategoryEnum } from '.'
import cn from '@/utils/classnames'

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
    <div className='flex min-h-16 w-full justify-center border-t border-divider-accent px-10'>
      <div className={cn('flex max-w-[1680px] grow border-x border-divider-accent p-6', currentCategory === CategoryEnum.CLOUD ? 'justify-between' : 'justify-end') }>
        {currentCategory === CategoryEnum.CLOUD && (
          <div className='flex flex-col text-text-tertiary'>
            <span className='system-xs-regular'>{t('billing.plansCommon.taxTip')}</span>
            <span className='system-xs-regular'>{t('billing.plansCommon.taxTipSecond')}</span>
          </div>
        )}
        <span className='flex h-fit items-center gap-x-1 text-saas-dify-blue-accessible'>
          <Link
            href={pricingPageURL}
            className='system-md-regular'
            target='_blank'
          >
            {t('billing.plansCommon.comparePlanAndFeatures')}
          </Link>
          <RiArrowRightUpLine className='size-4' />
        </span>
      </div>
    </div>
  )
}

export default React.memo(Footer)
