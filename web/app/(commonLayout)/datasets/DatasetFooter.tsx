'use client'

import { useTranslation } from 'react-i18next'

const DatasetFooter = () => {
  const { t } = useTranslation()

  return (
    <footer className='shrink-0 grow-0 px-12 py-6'>
      <h3 className='text-gradient text-xl font-semibold leading-tight'>{t('dataset.didYouKnow')}</h3>
      <p className='mt-1 text-sm font-normal leading-tight text-gray-700'>
        {t('dataset.intro1')}<span className='inline-flex items-center gap-1 text-blue-600'>{t('dataset.intro2')}</span>{t('dataset.intro3')}<br />
        {t('dataset.intro4')}<span className='inline-flex items-center gap-1 text-blue-600'>{t('dataset.intro5')}</span>{t('dataset.intro6')}
      </p>
    </footer>
  )
}

export default DatasetFooter
