import type { EvaluationResourceProps } from '../../../types'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { upload } from '@/service/base'
import { useEvaluationTemplateColumns, useStartEvaluationRunMutation } from '@/service/use-evaluation'
import { formatFileSize } from '@/utils/format'
import { useEvaluationResource, useEvaluationStore } from '../../../store'
import { buildEvaluationConfigPayload, buildEvaluationRunRequest } from '../../../store-utils'
import { buildTemplateCsvContent, getFileExtension } from './input-fields-utils'

type UploadedFileMeta = {
  name: string
  size: number
}

type UseInputFieldsActionsParams = EvaluationResourceProps & {
  isPanelReady: boolean
  isRunnable: boolean
  templateFileName: string
}

export const useInputFieldsActions = ({
  resourceType,
  resourceId,
  isPanelReady,
  isRunnable,
  templateFileName,
}: UseInputFieldsActionsParams) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const setBatchTab = useEvaluationStore(state => state.setBatchTab)
  const setSelectedRunId = useEvaluationStore(state => state.setSelectedRunId)
  const setUploadedFile = useEvaluationStore(state => state.setUploadedFile)
  const setUploadedFileName = useEvaluationStore(state => state.setUploadedFileName)
  const startRunMutation = useStartEvaluationRunMutation()
  const templateConfigPayload = useMemo(() => {
    return isPanelReady ? buildEvaluationConfigPayload(resource, resourceType) : null
  }, [isPanelReady, resource, resourceType])
  const templateColumnsQuery = useEvaluationTemplateColumns(resourceType, resourceId, templateConfigPayload, isPanelReady)
  const [isUploadPopoverOpen, setIsUploadPopoverOpen] = useState(false)
  const [uploadedFileMeta, setUploadedFileMeta] = useState<UploadedFileMeta | null>(null)
  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append('file', file)

      return upload({
        xhr: new XMLHttpRequest(),
        data: formData,
      })
    },
    onSuccess: (uploadedFile, file) => {
      setUploadedFile(resourceType, resourceId, {
        id: uploadedFile.id,
        name: typeof uploadedFile.name === 'string' ? uploadedFile.name : file.name,
      })
    },
    onError: () => {
      setUploadedFileMeta(null)
      setUploadedFile(resourceType, resourceId, null)
      toast.error(t('batch.uploadError'))
    },
  })

  const isFileUploading = uploadMutation.isPending
  const isRunning = startRunMutation.isPending
  const isTemplateColumnsLoading = templateColumnsQuery.isPending || templateColumnsQuery.isFetching
  const templateColumns = templateColumnsQuery.data?.columns ?? []
  const uploadedFileId = resource.uploadedFileId
  const currentFileName = uploadedFileMeta?.name ?? resource.uploadedFileName
  const canDownloadTemplate = isPanelReady && !isTemplateColumnsLoading && templateColumns.length > 0
  const isRunDisabled = !isRunnable || !uploadedFileId || isFileUploading || isRunning
  const uploadButtonDisabled = !isPanelReady || isTemplateColumnsLoading || isRunning

  const handleDownloadTemplate = () => {
    if (templateColumnsQuery.isError) {
      toast.error(t('batch.templateColumnsError'))
      return
    }

    if (!templateColumns.length) {
      toast.warning(t('batch.noTemplateColumns'))
      return
    }

    const content = buildTemplateCsvContent(templateColumns)
    const link = document.createElement('a')
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`
    link.download = templateFileName
    link.click()
  }

  const handleRun = () => {
    if (!isRunnable) {
      toast.warning(t('batch.validation'))
      return
    }

    if (isFileUploading) {
      toast.warning(t('batch.uploading'))
      return
    }

    if (!uploadedFileId) {
      toast.warning(t('batch.fileRequired'))
      return
    }

    const body = buildEvaluationRunRequest(resource, uploadedFileId, resourceType)

    if (!body) {
      toast.warning(t('batch.validation'))
      return
    }

    startRunMutation.mutate({
      params: {
        targetType: resourceType,
        targetId: resourceId,
      },
      body,
    }, {
      onSuccess: (run) => {
        toast.success(t('batch.runStarted'))
        setSelectedRunId(resourceType, resourceId, run.id)
        setIsUploadPopoverOpen(false)
        setBatchTab(resourceType, resourceId, 'history')
      },
      onError: () => {
        toast.error(t('batch.runFailed'))
      },
    })
  }

  const handleUploadFile = (file: File | undefined) => {
    if (!file) {
      setUploadedFileMeta(null)
      setUploadedFile(resourceType, resourceId, null)
      return
    }

    setUploadedFileMeta({
      name: file.name,
      size: file.size,
    })
    setUploadedFileName(resourceType, resourceId, file.name)
    uploadMutation.mutate(file)
  }

  const handleClearUploadedFile = () => {
    setUploadedFileMeta(null)
    setUploadedFile(resourceType, resourceId, null)
  }

  return {
    canDownloadTemplate,
    currentFileExtension: currentFileName ? getFileExtension(currentFileName) : '',
    currentFileName,
    currentFileSize: uploadedFileMeta ? formatFileSize(uploadedFileMeta.size) : '',
    handleClearUploadedFile,
    handleDownloadTemplate,
    handleRun,
    handleUploadFile,
    isFileUploading,
    isRunning,
    isRunDisabled,
    isTemplateColumnsLoading,
    isUploadPopoverOpen,
    setIsUploadPopoverOpen,
    templateColumns,
    uploadButtonDisabled,
  }
}
