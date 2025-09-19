import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { RiArrowRightUpLine } from '@remixicon/react'

type FooterProps = {
  pricingPageURL: string
}

const Footer = ({
  pricingPageURL,
}: FooterProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex min-h-16 w-full justify-center border-t border-divider-accent px-10'>
      <div className='flex max-w-[1680px] grow justify-end border-x border-divider-accent p-6'>
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
