'use client'
import { useEducationInit } from '@/app/education-apply/hooks'
import List from './list'
import useDocumentTitle from '@/hooks/use-document-title'
import { useTranslation } from 'react-i18next'
import AppListContext from '@/context/app-list-context'
import { useState } from 'react'
import type { CurrentTryAppParams } from '@/context/explore-context'

const Apps = () => {
  const { t } = useTranslation()

  useDocumentTitle(t('common.menus.apps'))
  useEducationInit()

  const [currentTryAppParams, setCurrentTryAppParams] = useState<CurrentTryAppParams | undefined>(undefined)
  const [isShowTryAppPanel, setIsShowTryAppPanel] = useState(false)
  const setShowTryAppPanel = (showTryAppPanel: boolean, params?: CurrentTryAppParams) => {
    if (showTryAppPanel)
      setCurrentTryAppParams(params)
    else
      setCurrentTryAppParams(undefined)
    setIsShowTryAppPanel(showTryAppPanel)
  }

  return (
    <AppListContext.Provider value={{
      currentApp: currentTryAppParams,
      isShowTryAppPanel,
      setShowTryAppPanel,
    }}>
      <div className='relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body'>
        <List />
      </div >
    </AppListContext.Provider>
  )
}

export default Apps
