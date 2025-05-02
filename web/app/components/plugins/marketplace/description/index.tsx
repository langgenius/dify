import {
  getLocaleOnServer,
  useTranslation as translate,
} from '@/i18n/server'

type DescriptionProps = {
  locale?: string
}
const Description = async ({
  locale: localeFromProps,
}: DescriptionProps) => {
  const localeDefault = getLocaleOnServer()
  const { t } = await translate(localeFromProps || localeDefault, 'plugin')
  const { t: tCommon } = await translate(localeFromProps || localeDefault, 'common')
  const isZhHans = localeFromProps === 'zh-Hans'

  return (
    <>
      <h1 className='shrink-0 mb-2 text-center title-4xl-semi-bold text-text-primary'>
        {t('marketplace.empower')}
      </h1>
      <h2 className='shrink-0 flex justify-center items-center text-center body-md-regular text-text-tertiary'>
        {
          isZhHans && (
            <>
              <span className='mr-1'>{tCommon('operation.in')}</span>
              {t('marketplace.difyMarketplace')}
              {t('marketplace.discover')}
            </>
          )
        }
        {
          !isZhHans && (
            <>
              {t('marketplace.discover')}
            </>
          )
        }
        <span className="relative ml-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected z-[1]">
          <span className='relative z-[2] lowercase'>{t('category.models')}</span>
        </span>
        ,
        <span className="relative ml-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected z-[1]">
          <span className='relative z-[2] lowercase'>{t('category.tools')}</span>
        </span>
        ,
        <span className="relative ml-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected z-[1]">
          <span className='relative z-[2] lowercase'>{t('category.agents')}</span>
        </span>
        ,
        <span className="relative ml-1 mr-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected z-[1]">
          <span className='relative z-[2] lowercase'>{t('category.extensions')}</span>
        </span>
        {t('marketplace.and')}
        <span className="relative ml-1 mr-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected z-[1]">
          <span className='relative z-[2] lowercase'>{t('category.bundles')}</span>
        </span>
        {
          !isZhHans && (
            <>
              <span className='mr-1'>{tCommon('operation.in')}</span>
              {t('marketplace.difyMarketplace')}
            </>
          )
        }
      </h2>
    </>
  )
}

export default Description
