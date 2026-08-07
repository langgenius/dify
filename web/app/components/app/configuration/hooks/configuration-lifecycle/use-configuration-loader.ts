import type { Dispatch, SetStateAction } from 'react'
import type { ConfigurationPublishConfig } from './types'
import type { Collection } from '@/app/components/tools/types'
import type { AnnotationReplyConfig } from '@/models/debug'
import type { AppModeEnum } from '@/types/app'
import { useEffect, useRef } from 'react'
import { basePath } from '@/utils/var'
import { loadConfigurationState } from './load'

type ConfigurationLoaderOperations = {
  currentRerankModel?: string
  currentRerankProvider?: string
  resetUnpublishedChanges: () => void
  setAnnotationConfig: (config: AnnotationReplyConfig, notSetFormatChanged?: boolean) => void
  setCollectionList: Dispatch<SetStateAction<Collection[]>>
  setHasFetchedDetail: Dispatch<SetStateAction<boolean>>
  setMode: Dispatch<SetStateAction<AppModeEnum>>
  setPublishedConfig: Dispatch<SetStateAction<ConfigurationPublishConfig | null>>
  startTracking: () => void
  stopTracking: () => void
  syncToPublishedConfig: (config: ConfigurationPublishConfig) => void
}

export function useConfigurationLoader({
  appId,
  ...operations
}: ConfigurationLoaderOperations & { appId: string }) {
  const operationsRef = useRef(operations)
  operationsRef.current = operations

  useEffect(() => {
    const current = operationsRef.current
    current.stopTracking()
    void (async () => {
      const configurationState = await loadConfigurationState({
        appId,
        basePath,
        currentRerankModel: current.currentRerankModel,
        currentRerankProvider: current.currentRerankProvider,
      })

      current.setCollectionList(configurationState.collectionList)
      current.setMode(configurationState.mode)
      current.syncToPublishedConfig(configurationState.publishedConfig)
      if (configurationState.annotationConfig)
        current.setAnnotationConfig(configurationState.annotationConfig, true)

      current.setPublishedConfig(configurationState.publishedConfig)
      current.resetUnpublishedChanges()
      current.startTracking()
      current.setHasFetchedDetail(true)
    })()
  }, [appId])
}
