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

  return (
    <>
      <h1 className='mb-2 text-center title-4xl-semi-bold text-text-primary'>
        Empower your AI development
      </h1>
      <h2 className='flex justify-center items-center text-center body-md-regular text-text-tertiary'>
        Discover
        <span className="relative ml-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
          {t('category.models')}
        </span>
        ,
        <span className="relative ml-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
          {t('category.tools')}
        </span>
        ,
        <span className="relative ml-1 mr-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
          {t('category.extensions')}
        </span>
        and
        <span className="relative ml-1 mr-1 body-md-medium text-text-secondary after:content-[''] after:absolute after:left-0 after:bottom-[1.5px] after:w-full after:h-2 after:bg-text-text-selected">
          {t('category.bundles')}
        </span>
        in Dify Marketplace
      </h2>
    </>
  )
}

export default Description
