import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { OnlineDriveFile } from '@/models/pipeline'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DatasourceType } from '@/models/pipeline'

type DatasourceUIStateParams = {
  datasource: Datasource | undefined
  allFileLoaded: boolean
  localFileListLength: number
  onlineDocumentsLength: number
  websitePagesLength: number
  selectedFileIdsLength: number
  onlineDriveFileList: OnlineDriveFile[]
  isVectorSpaceFull: boolean
  enableBilling: boolean
  currentWorkspacePagesLength: number
  fileUploadConfig: { file_size_limit: number, batch_count_limit: number }
}

/**
 * Hook for computing datasource UI state based on datasource type
 */
export const useDatasourceUIState = ({
  datasource,
  allFileLoaded,
  localFileListLength,
  onlineDocumentsLength,
  websitePagesLength,
  selectedFileIdsLength,
  onlineDriveFileList,
  isVectorSpaceFull,
  enableBilling,
  currentWorkspacePagesLength,
  fileUploadConfig,
}: DatasourceUIStateParams) => {
  const { t } = useTranslation()
  const datasourceType = datasource?.nodeData.provider_type

  const isShowVectorSpaceFull = useMemo(() => {
    if (!datasource || !datasourceType)
      return false

    // Lookup table for vector space full condition check
    const vectorSpaceFullConditions: Record<string, boolean> = {
      [DatasourceType.localFile]: allFileLoaded,
      [DatasourceType.onlineDocument]: onlineDocumentsLength > 0,
      [DatasourceType.websiteCrawl]: websitePagesLength > 0,
      [DatasourceType.onlineDrive]: onlineDriveFileList.length > 0,
    }

    const condition = vectorSpaceFullConditions[datasourceType]
    return condition && isVectorSpaceFull && enableBilling
  }, [datasource, datasourceType, allFileLoaded, onlineDocumentsLength, websitePagesLength, onlineDriveFileList.length, isVectorSpaceFull, enableBilling])

  // Lookup table for next button disabled conditions
  const nextBtnDisabled = useMemo(() => {
    if (!datasource || !datasourceType)
      return true

    const disabledConditions: Record<string, boolean> = {
      [DatasourceType.localFile]: isShowVectorSpaceFull || localFileListLength === 0 || !allFileLoaded,
      [DatasourceType.onlineDocument]: isShowVectorSpaceFull || onlineDocumentsLength === 0,
      [DatasourceType.websiteCrawl]: isShowVectorSpaceFull || websitePagesLength === 0,
      [DatasourceType.onlineDrive]: isShowVectorSpaceFull || selectedFileIdsLength === 0,
    }

    return disabledConditions[datasourceType] ?? true
  }, [datasource, datasourceType, isShowVectorSpaceFull, localFileListLength, allFileLoaded, onlineDocumentsLength, websitePagesLength, selectedFileIdsLength])

  // Check if select all should be shown
  const showSelect = useMemo(() => {
    if (datasourceType === DatasourceType.onlineDocument)
      return currentWorkspacePagesLength > 0

    if (datasourceType === DatasourceType.onlineDrive) {
      const nonBucketItems = onlineDriveFileList.filter(item => item.type !== 'bucket')
      const isBucketList = onlineDriveFileList.some(file => file.type === 'bucket')
      return !isBucketList && nonBucketItems.length > 0
    }

    return false
  }, [currentWorkspacePagesLength, datasourceType, onlineDriveFileList])

  // Total selectable options count
  const totalOptions = useMemo(() => {
    if (datasourceType === DatasourceType.onlineDocument)
      return currentWorkspacePagesLength

    if (datasourceType === DatasourceType.onlineDrive)
      return onlineDriveFileList.filter(item => item.type !== 'bucket').length

    return undefined
  }, [currentWorkspacePagesLength, datasourceType, onlineDriveFileList])

  // Selected options count
  const selectedOptions = useMemo(() => {
    if (datasourceType === DatasourceType.onlineDocument)
      return onlineDocumentsLength

    if (datasourceType === DatasourceType.onlineDrive)
      return selectedFileIdsLength

    return undefined
  }, [datasourceType, onlineDocumentsLength, selectedFileIdsLength])

  // Tip message for selection
  const tip = useMemo(() => {
    if (datasourceType === DatasourceType.onlineDocument)
      return t('addDocuments.selectOnlineDocumentTip', { ns: 'datasetPipeline', count: 50 })

    if (datasourceType === DatasourceType.onlineDrive) {
      return t('addDocuments.selectOnlineDriveTip', {
        ns: 'datasetPipeline',
        count: fileUploadConfig.batch_count_limit,
        fileSize: fileUploadConfig.file_size_limit,
      })
    }

    return ''
  }, [datasourceType, fileUploadConfig.batch_count_limit, fileUploadConfig.file_size_limit, t])

  return {
    datasourceType,
    isShowVectorSpaceFull,
    nextBtnDisabled,
    showSelect,
    totalOptions,
    selectedOptions,
    tip,
  }
}
