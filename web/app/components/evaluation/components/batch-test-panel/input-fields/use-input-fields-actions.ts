import type { EvaluationResourceProps } from '../../../types'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { downloadBlob } from '@/utils/download'
import { formatFileSize } from '@/utils/format'
import { useEvaluationActions, useEvaluationTemplateColumns } from '../../../queries'
import { useEvaluationResource, useEvaluationStore } from '../../../store'
import { buildEvaluationConfigPayload, buildEvaluationRunRequest } from '../../../store-utils'
import { DATASET_TEMPLATE_FIELDS, getFileExtension } from './input-fields-utils'

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
  const setBatchTab = useEvaluationStore((state) => state.setBatchTab)
  const setSelectedRunId = useEvaluationStore((state) => state.setSelectedRunId)
  const setUploadedFile = useEvaluationStore((state) => state.setUploadedFile)
  const setUploadedFileName = useEvaluationStore((state) => state.setUploadedFileName)
  const evaluationActions = useEvaluationActions({ resourceType, resourceId })
  const templateConfigPayload = useMemo(() => {
    return isPanelReady ? buildEvaluationConfigPayload(resource, resourceType, resourceId) : null
  }, [isPanelReady, resource, resourceId, resourceType])
  const templateColumnsQuery = useEvaluationTemplateColumns(
    { resourceType, resourceId },
    templateConfigPayload,
    isPanelReady,
  )
  const [isUploadPopoverOpen, setIsUploadPopoverOpen] = useState(false)
  const [uploadedFileMeta, setUploadedFileMeta] = useState<UploadedFileMeta | null>(null)
  const uploadMutation = useMutation({
    ...consoleQuery.files.upload.post.mutationOptions(),
    onSuccess: (uploadedFile, input) => {
      const file = input.body.file
      setUploadedFile(resourceType, resourceId, {
        id: uploadedFile.id,
        name: uploadedFile.name || (file instanceof File ? file.name : ''),
      })
    },
    onError: () => {
      setUploadedFileMeta(null)
      setUploadedFile(resourceType, resourceId, null)
      toast.error(t(($) => $['batch.uploadError']))
    },
  })

  const isFileUploading = uploadMutation.isPending
  const isRunning = evaluationActions.isRunning
  const isTemplateColumnsLoading =
    resourceType !== 'datasets' &&
    (templateColumnsQuery.isPending || templateColumnsQuery.isFetching)
  const templateColumns =
    resourceType === 'datasets'
      ? DATASET_TEMPLATE_FIELDS
      : (templateColumnsQuery.data?.columns ?? [])
  const uploadedFileId = resource.uploadedFileId
  const currentFileName = uploadedFileMeta?.name ?? resource.uploadedFileName
  const canDownloadTemplate = isPanelReady && !evaluationActions.isDownloadingTemplate
  const isRunDisabled = !isRunnable || !uploadedFileId || isFileUploading || isRunning
  const uploadButtonDisabled = !isPanelReady || isRunning

  const handleDownloadTemplate = async () => {
    try {
      const file = await evaluationActions.downloadTemplate()
      downloadBlob({ data: file, fileName: templateFileName })
    } catch {
      toast.error(t(($) => $['batch.templateDownloadError']))
    }
  }

  const handleRun = async () => {
    if (!isRunnable) {
      toast.warning(t(($) => $['batch.validation']))
      return
    }

    if (isFileUploading) {
      toast.warning(t(($) => $['batch.uploading']))
      return
    }

    if (!uploadedFileId) {
      toast.warning(t(($) => $['batch.fileRequired']))
      return
    }

    const body = buildEvaluationRunRequest(resource, uploadedFileId, resourceType, resourceId)

    if (!body) {
      toast.warning(t(($) => $['batch.validation']))
      return
    }

    try {
      const run = await evaluationActions.runEvaluation(body)
      toast.success(t(($) => $['batch.runStarted']))
      setSelectedRunId(resourceType, resourceId, run.id)
      setIsUploadPopoverOpen(false)
      setBatchTab(resourceType, resourceId, 'history')
    } catch {
      toast.error(t(($) => $['batch.runFailed']))
    }
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
    uploadMutation.mutate({ body: { file } })
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
