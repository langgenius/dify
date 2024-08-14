'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import Button from '@/app/components/base/button'

export type IContrlBtnGroupProps = {
  onSave: () => void
  onReset: () => void
}

const ContrlBtnGroup: FC<IContrlBtnGroupProps> = ({ onSave, onReset }) => {
  const { t } = useTranslation()
  return (
    <div className="fixed left-[224px] bottom-0 w-[519px] h-[64px]">
      <div className={`${s.ctrlBtn} flex items-center h-full pl-4  gap-2 bg-white`}>
        <Button variant='primary' onClick={onSave}>{t('appDebug.operation.applyConfig')}</Button>
        <Button onClick={onReset}>{t('appDebug.operation.resetConfig')}</Button>
      </div>
    </div>
  )
}
export default React.memo(ContrlBtnGroup)
