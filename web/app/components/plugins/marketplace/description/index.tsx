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
  const localeDefault = await getLocaleOnServer()
  const { t } = await translate(localeFromProps || localeDefault, 'plugin')
  const { t: tCommon } = await translate(localeFromProps || localeDefault, 'common')
  const isZhHans = localeFromProps === 'zh-Hans'

  return (
    <>
      <h1 className='title-4xl-semi-bold text-text-primary mb-2 shrink-0 text-center'>
        {t('marketplace.empower')}
      </h1>
      <h2 className='body-md-regular text-text-tertiary flex shrink-0 items-center justify-center text-center'>
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
        <span className="body-md-medium text-text-secondary after:bg-text-text-selected relative z-[1] ml-1 after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:content-['']">
          <span className='relative z-[2] lowercase'>{t('category.models')}</span>
        </span>
        ,
        <span className="body-md-medium text-text-secondary after:bg-text-text-selected relative z-[1] ml-1 after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:content-['']">
          <span className='relative z-[2] lowercase'>{t('category.tools')}</span>
        </span>
        ,
        <span className="body-md-medium text-text-secondary after:bg-text-text-selected relative z-[1] ml-1 after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:content-['']">
          <span className='relative z-[2] lowercase'>{t('category.agents')}</span>
        </span>
        ,
        <span className="body-md-medium text-text-secondary after:bg-text-text-selected relative z-[1] ml-1 mr-1 after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:content-['']">
          <span className='relative z-[2] lowercase'>{t('category.extensions')}</span>
        </span>
        {t('marketplace.and')}
        <span className="body-md-medium text-text-secondary after:bg-text-text-selected relative z-[1] ml-1 mr-1 after:absolute after:bottom-[1.5px] after:left-0 after:h-2 after:w-full after:content-['']">
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
