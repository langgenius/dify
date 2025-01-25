'use client'

import { useTranslation } from 'react-i18next'

const DatasetFooter = () => {
  const { t } = useTranslation()

  return (
    <footer className='px-12 py-6 grow-0 shrink-0'>
      <h3 className='text-xl font-semibold leading-tight text-gradient'>{t('dataset.didYouKnow')}</h3>
      <p className='mt-1 text-sm font-normal leading-tight text-gray-700'>
        {t('dataset.intro1')}<span className='inline-flex items-center gap-1 text-blue-600'>{t('dataset.intro2')}</span>{t('dataset.intro3')}<br />
        {t('dataset.intro4')}<span className='inline-flex items-center gap-1 text-blue-600'>{t('dataset.intro5')}</span>{t('dataset.intro6')}
      </p>
    </footer>
  )
}

export default DatasetFooter
