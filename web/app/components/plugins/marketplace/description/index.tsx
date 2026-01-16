import { useLocale, useTranslation } from '#i18n'

const Description = () => {
  const { t } = useTranslation('plugin')
  const { t: tCommon } = useTranslation('common')
  const locale = useLocale()

  const isZhHans = locale === 'zh-Hans'

  return (
    <>
      <h1 className="title-4xl-semi-bold mb-2 shrink-0 text-center text-text-primary">
        {t('marketplace.empower')}
      </h1>
      <h2 className="body-md-regular flex shrink-0 items-center justify-center text-center text-text-tertiary">
        {
          isZhHans && (
            <>
              <span className="mr-1">{tCommon('operation.in')}</span>
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
        <span className="body-md-medium relative z-[1] ml-1 text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
          {t('category.models')}
        </span>
        ,
        <span className="body-md-medium relative z-[1] ml-1 text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
          {t('category.tools')}
        </span>
        ,
        <span className="body-md-medium relative z-[1] ml-1 text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
          {t('category.datasources')}
        </span>
        ,
        <span className="body-md-medium relative z-[1] ml-1 text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
          {t('category.triggers')}
        </span>
        ,
        <span className="body-md-medium relative z-[1] ml-1 text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
          {t('category.agents')}
        </span>
        ,
        <span className="body-md-medium relative z-[1] ml-1 mr-1 text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
          {t('category.extensions')}
        </span>
        {t('marketplace.and')}
        <span className="body-md-medium relative z-[1] ml-1 mr-1 text-text-secondary after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:bg-text-text-selected after:content-['']">
          {t('category.bundles')}
        </span>
        {
          !isZhHans && (
            <>
              <span className="mr-1">{tCommon('operation.in')}</span>
              {t('marketplace.difyMarketplace')}
            </>
          )
        }
      </h2>
    </>
  )
}

export default Description
