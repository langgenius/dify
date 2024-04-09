'use client'

import { forwardRef } from 'react'
import classNames from 'classnames'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import style from '../list.module.css'

const CreateAppCard = forwardRef<HTMLAnchorElement>((_, ref) => {
  const { t } = useTranslation()

  return (
    <Link ref={ref} className={classNames(style.listItem, style.newItemCard)} href='/datasets/create'>
      <div className={style.listItemTitle}>
        <span className={style.newItemIcon}>
          <span className={classNames(style.newItemIconImage, style.newItemIconAdd)} />
        </span>
        <div className={classNames(style.listItemHeading, style.newItemCardHeading)}>
          {t('dataset.createDataset')}
        </div>
      </div>
      <div className={style.listItemDescription}>{t('dataset.createDatasetIntro')}</div>
      {/* <div className='text-xs text-gray-500'>{t('app.createFromConfigFile')}</div> */}
    </Link>
  )
})

CreateAppCard.displayName = 'CreateAppCard'

export default CreateAppCard
