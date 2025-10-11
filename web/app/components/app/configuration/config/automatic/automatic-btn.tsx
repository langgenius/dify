'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiSparklingFill,
} from '@remixicon/react'
import Button from '@/app/components/base/button'

export type IAutomaticBtnProps = {
  onClick: () => void
}
const AutomaticBtn: FC<IAutomaticBtnProps> = ({
  onClick,
}) => {
  const { t } = useTranslation()

  return (
    <Button variant='secondary-accent' size='small' onClick={onClick}>
      <RiSparklingFill className='mr-1 h-3.5 w-3.5' />
      <span className=''>{t('appDebug.operation.automatic')}</span>
    </Button>
  )
}
export default React.memo(AutomaticBtn)
