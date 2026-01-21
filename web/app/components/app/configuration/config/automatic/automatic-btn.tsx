'use client'
import type { FC } from 'react'
import {
  RiSparklingFill,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

export type IAutomaticBtnProps = {
  onClick: () => void
}
const AutomaticBtn: FC<IAutomaticBtnProps> = ({
  onClick,
}) => {
  const { t } = useTranslation()

  return (
    <Button variant="secondary-accent" size="small" onClick={onClick}>
      <RiSparklingFill className="mr-1 h-3.5 w-3.5" />
      <span className="">{t('operation.automatic', { ns: 'appDebug' })}</span>
    </Button>
  )
}
export default React.memo(AutomaticBtn)
