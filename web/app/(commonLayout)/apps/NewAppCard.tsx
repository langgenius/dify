'use client'

import { forwardRef, useState } from 'react'
import classNames from 'classnames'
import { useTranslation } from 'react-i18next'
import style from '../list.module.css'
import NewAppDialog from './NewAppDialog'
import { useProviderContext } from '@/context/provider-context'

export type CreateAppCardProps = {
  onSuccess?: () => void
}

const CreateAppCard = forwardRef<HTMLAnchorElement, CreateAppCardProps>(({ onSuccess }, ref) => {
  const { t } = useTranslation()
  const { onPlanInfoChanged } = useProviderContext()

  const [showNewAppDialog, setShowNewAppDialog] = useState(false)
  return (
    <a ref={ref} className={classNames(style.listItem, style.newItemCard)} onClick={() => setShowNewAppDialog(true)}>
      <div className={style.listItemTitle}>
        <span className={style.newItemIcon}>
          <span className={classNames(style.newItemIconImage, style.newItemIconAdd)} />
        </span>
        <div className={classNames(style.listItemHeading, style.newItemCardHeading)}>
          {t('app.createApp')}
        </div>
      </div>
      {/* <div className='text-xs text-gray-500'>{t('app.createFromConfigFile')}</div> */}
      <NewAppDialog show={showNewAppDialog} onSuccess={
        () => {
          onPlanInfoChanged()
          if (onSuccess)
            onSuccess()
        }} onClose={() => setShowNewAppDialog(false)} />
    </a>
  )
})

export default CreateAppCard
