'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'

const DatasetFooter = () => {
  const { t } = useTranslation()

  return (
    <footer className="shrink-0 px-12 py-6">
      <h3 className="text-gradient text-xl leading-tight font-semibold">{t('didYouKnow', { ns: 'dataset' })}</h3>
      <p className="mt-1 text-sm leading-tight font-normal text-text-secondary">
        {t('intro1', { ns: 'dataset' })}
        <span className="inline-flex items-center gap-1 text-text-accent">{t('intro2', { ns: 'dataset' })}</span>
        {t('intro3', { ns: 'dataset' })}
        <br />
        {t('intro4', { ns: 'dataset' })}
        <span className="inline-flex items-center gap-1 text-text-accent">{t('intro5', { ns: 'dataset' })}</span>
        {t('intro6', { ns: 'dataset' })}
      </p>
    </footer>
  )
}

export default React.memo(DatasetFooter)
