'use client'
import { useContextSelector } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import Apps from './Apps'
import AppContext from '@/context/app-context'
import { useEducationInit } from '@/app/education-apply/hooks'

const AppList = () => {
  const { t } = useTranslation()
  useEducationInit()

  const systemFeatures = useContextSelector(AppContext, v => v.systemFeatures)

  return (
    <div className='relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body'>
      <Apps />
    </div >
  )
}

export default AppList
