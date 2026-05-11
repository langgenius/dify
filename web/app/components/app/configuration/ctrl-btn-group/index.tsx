'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'

type IContrlBtnGroupProps = {
  onSave: () => void
  onReset: () => void
}

const ContrlBtnGroup: FC<IContrlBtnGroupProps> = ({ onSave, onReset }) => {
  const { t } = useTranslation()
  return (
    <div className="fixed bottom-0 left-[224px] h-[64px] w-[519px]">
      <div className={`${s.ctrlBtn} flex h-full items-center gap-2 bg-white pl-4`}>
        <Button variant="primary" onClick={onSave}>{t('operation.applyConfig', { ns: 'appDebug' })}</Button>
        <Button onClick={onReset}>{t('operation.resetConfig', { ns: 'appDebug' })}</Button>
      </div>
    </div>
  )
}
export default React.memo(ContrlBtnGroup)
