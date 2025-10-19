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
    <div className="fixed bottom-0 left-[224px] h-[64px] w-[519px]">
      <div className={`${s.ctrlBtn} flex h-full items-center gap-2  bg-white pl-4`}>
        <Button variant='primary' onClick={onSave}>{t('appDebug.operation.applyConfig')}</Button>
        <Button onClick={onReset}>{t('appDebug.operation.resetConfig')}</Button>
      </div>
    </div>
  )
}
export default React.memo(ContrlBtnGroup)
