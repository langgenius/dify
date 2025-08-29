'use client'
import React, { createContext, useContext, useState } from 'react'
import type { FC, ReactNode } from 'react'
import type { PluginDetail } from '@/app/components/plugins/types'
import ReadmeDrawer from './index'

type ReadmePanelContextValue = {
  openReadme: (detail: PluginDetail, showType?: ReadmeShowType) => void
  closeReadme: () => void
  currentDetailInfo?: {
    detail: PluginDetail
    showType: ReadmeShowType
  }
}

const ReadmePanelContext = createContext<ReadmePanelContextValue | null>(null)

export const useReadmePanel = (): ReadmePanelContextValue => {
  const context = useContext(ReadmePanelContext)
  if (!context)
    throw new Error('useReadmePanel must be used within ReadmePanelProvider')

  return context
}

type ReadmePanelProviderProps = {
  children: ReactNode
}

export enum ReadmeShowType {
  drawer = 'drawer',
  modal = 'modal',
}

export const ReadmePanelProvider: FC<ReadmePanelProviderProps> = ({ children }) => {
  const [currentDetailInfo, setCurrentDetailInfo] = useState<{
    detail: PluginDetail
    showType: ReadmeShowType
  } | undefined>()

  const openReadme = (detail: PluginDetail, showType?: ReadmeShowType) => {
    setCurrentDetailInfo({
      detail,
      showType: showType || ReadmeShowType.drawer,
    })
  }

  const closeReadme = () => {
    setCurrentDetailInfo(undefined)
  }

  // todo: use zustand
  return (
    <ReadmePanelContext.Provider value={{
      openReadme,
      closeReadme,
      currentDetailInfo,
    }}>
      {children}
      <ReadmeDrawer />
    </ReadmePanelContext.Provider>
  )
}
