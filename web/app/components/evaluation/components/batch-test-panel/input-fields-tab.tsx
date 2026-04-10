import type { ChangeEvent } from 'react'
import type { EvaluationResourceProps } from '../../types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { InputVar, Node } from '@/app/components/workflow/types'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { toast } from '@/app/components/base/ui/toast'
import { inputVarTypeToVarType } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { upload } from '@/service/base'
import { useStartEvaluationRunMutation } from '@/service/use-evaluation'
import { useSnippetPublishedWorkflow } from '@/service/use-snippet-workflows'
import { useAppWorkflow } from '@/service/use-workflow'
import { getEvaluationMockConfig } from '../../mock'
import { useEvaluationResource, useEvaluationStore } from '../../store'
import { buildEvaluationRunRequest } from '../../store-utils'

type InputFieldsTabProps = EvaluationResourceProps & {
  isPanelReady: boolean
  isRunnable: boolean
}

type InputField = {
  name: string
  type: string
}

const getGraphNodes = (graph?: Record<string, unknown>) => {
  return Array.isArray(graph?.nodes) ? graph.nodes as Node[] : []
}

const getStartNodeInputFields = (nodes?: Node[]): InputField[] => {
  const startNode = nodes?.find(node => node.data.type === BlockEnum.Start) as Node<StartNodeType> | undefined
  const variables = startNode?.data.variables

  if (!Array.isArray(variables))
    return []

  return variables
    .filter((variable): variable is InputVar => typeof variable.variable === 'string' && !!variable.variable)
    .map(variable => ({
      name: variable.variable,
      type: inputVarTypeToVarType(variable.type ?? InputVarType.textInput),
    }))
}

const escapeCsvCell = (value: string) => {
  if (!/[",\n\r]/.test(value))
    return value

  return `"${value.replace(/"/g, '""')}"`
}

const InputFieldsTab = ({
  resourceType,
  resourceId,
  isPanelReady,
  isRunnable,
}: InputFieldsTabProps) => {
  const { t } = useTranslation('evaluation')
  const config = getEvaluationMockConfig(resourceType)
  const { data: currentAppWorkflow, isLoading: isAppWorkflowLoading } = useAppWorkflow(resourceType === 'apps' ? resourceId : '')
  const { data: currentSnippetWorkflow, isLoading: isSnippetWorkflowLoading } = useSnippetPublishedWorkflow(resourceType === 'snippets' ? resourceId : '')
  const inputFields = useMemo(() => {
    if (resourceType === 'apps')
      return getStartNodeInputFields(currentAppWorkflow?.graph.nodes)

    if (resourceType === 'snippets')
      return getStartNodeInputFields(getGraphNodes(currentSnippetWorkflow?.graph))

    return []
  }, [currentAppWorkflow?.graph.nodes, currentSnippetWorkflow?.graph, resourceType])
  const resource = useEvaluationResource(resourceType, resourceId)
  const uploadedFileId = resource.uploadedFileId
  const uploadedFileName = resource.uploadedFileName
  const setBatchTab = useEvaluationStore(state => state.setBatchTab)
  const setUploadedFile = useEvaluationStore(state => state.setUploadedFile)
  const setUploadedFileName = useEvaluationStore(state => state.setUploadedFileName)
  const startRunMutation = useStartEvaluationRunMutation()
  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData()
      formData.append('file', file)

      return upload({
        xhr: new XMLHttpRequest(),
        data: formData,
      })
    },
    onSuccess: (uploadedFile) => {
      setUploadedFile(resourceType, resourceId, {
        id: uploadedFile.id,
        name: typeof uploadedFile.name === 'string' ? uploadedFile.name : uploadedFileName ?? uploadedFile.id,
      })
    },
    onError: () => {
      setUploadedFile(resourceType, resourceId, null)
      toast.error(t('batch.uploadError'))
    },
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isFileUploading = uploadMutation.isPending
  const isRunning = startRunMutation.isPending
  const isInputFieldsLoading = (resourceType === 'apps' && isAppWorkflowLoading)
    || (resourceType === 'snippets' && isSnippetWorkflowLoading)
  const canDownloadTemplate = isPanelReady && !isInputFieldsLoading && inputFields.length > 0
  const isRunDisabled = !isRunnable || !uploadedFileId || isFileUploading || isRunning

  const handleDownloadTemplate = () => {
    if (!inputFields.length) {
      toast.warning(t('batch.noInputFields'))
      return
    }

    const content = `${inputFields.map(field => escapeCsvCell(field.name)).join(',')}\n`
    const link = document.createElement('a')
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`
    link.download = config.templateFileName
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

    const body = buildEvaluationRunRequest(resource, uploadedFileId)

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
      onSuccess: () => {
        toast.success(t('batch.runStarted'))
        setBatchTab(resourceType, resourceId, 'history')
      },
      onError: () => {
        toast.error(t('batch.runFailed'))
      },
    })
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      setUploadedFile(resourceType, resourceId, null)
      return
    }

    setUploadedFileName(resourceType, resourceId, file.name)
    uploadMutation.mutate(file)
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="system-md-semibold text-text-primary">{t('batch.requirementsTitle')}</div>
        <div className="mt-1 system-xs-regular text-text-tertiary">{t('batch.requirementsDescription')}</div>
        <div className="mt-3 rounded-xl bg-background-section p-3">
          {isInputFieldsLoading && (
            <div className="px-1 py-0.5 system-xs-regular text-text-tertiary">
              {t('batch.loadingInputFields')}
            </div>
          )}
          {!isInputFieldsLoading && inputFields.length === 0 && (
            <div className="px-1 py-0.5 system-xs-regular text-text-tertiary">
              {t('batch.noInputFields')}
            </div>
          )}
          {!isInputFieldsLoading && inputFields.map(field => (
            <div key={field.name} className="flex items-center py-1">
              <div className="rounded px-1 py-0.5 system-xs-medium text-text-tertiary">
                {field.name}
              </div>
              <div className="text-[10px] leading-3 text-text-quaternary">
                {field.type}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <Button variant="secondary" className="w-full justify-center" disabled={!canDownloadTemplate} onClick={handleDownloadTemplate}>
          <span aria-hidden="true" className="mr-1 i-ri-download-line h-4 w-4" />
          {t('batch.downloadTemplate')}
        </Button>
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept=".csv,.xlsx"
          onChange={handleFileChange}
        />
        {isPanelReady && (
          <button
            type="button"
            className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-divider-subtle bg-background-default-subtle px-4 py-6 text-center hover:border-components-button-secondary-border"
            onClick={() => fileInputRef.current?.click()}
          >
            <span aria-hidden="true" className="i-ri-file-upload-line h-5 w-5 text-text-tertiary" />
            <div className="mt-2 system-sm-semibold text-text-primary">{t('batch.uploadTitle')}</div>
            <div className="mt-1 system-xs-regular text-text-tertiary">
              {isFileUploading ? t('batch.uploading') : uploadedFileName ?? t('batch.uploadHint')}
            </div>
          </button>
        )}
      </div>
      {!isRunnable && (
        <div className="rounded-xl border border-divider-subtle bg-background-default-subtle px-3 py-2 system-xs-regular text-text-tertiary">
          {t('batch.validation')}
        </div>
      )}
      <Button className="w-full justify-center" variant="primary" disabled={isRunDisabled} loading={isRunning} onClick={handleRun}>
        {t('batch.run')}
      </Button>
    </div>
  )
}

export default InputFieldsTab
