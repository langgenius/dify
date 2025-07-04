'use client'
import React, { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import AppInputsForm from '@/app/components/plugins/plugin-detail-panel/app-selector/app-inputs-form'
import { useAppDetail } from '@/service/use-apps'
import { useAppWorkflow } from '@/service/use-workflow'
import { useFileUploadConfig } from '@/service/use-common'
import { Resolution } from '@/types/app'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import type { App } from '@/types/app'
import type { FileUpload } from '@/app/components/base/features/types'
import { BlockEnum, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'

import cn from '@/utils/classnames'

type Props = {
  value?: {
    app_id: string
    inputs: Record<string, any>
  }
  appDetail: App
  onFormChange: (value: Record<string, any>) => void
}

const AppInputsPanel = ({
  value,
  appDetail,
  onFormChange,
}: Props) => {
  const { t } = useTranslation()
  const inputsRef = useRef<any>(value?.inputs || {})
  const isBasicApp = appDetail.mode !== 'advanced-chat' && appDetail.mode !== 'workflow'
  const { data: fileUploadConfig } = useFileUploadConfig()
  const { data: currentApp, isFetching: isAppLoading } = useAppDetail(appDetail.id)
  const { data: currentWorkflow, isFetching: isWorkflowLoading } = useAppWorkflow(isBasicApp ? '' : appDetail.id)
  const isLoading = isAppLoading || isWorkflowLoading

  const basicAppFileConfig = useMemo(() => {
    let fileConfig: FileUpload
    if (isBasicApp)
      fileConfig = currentApp?.model_config?.file_upload as FileUpload
    else
      fileConfig = currentWorkflow?.features?.file_upload as FileUpload
    return {
      image: {
        detail: fileConfig?.image?.detail || Resolution.high,
        enabled: !!fileConfig?.image?.enabled,
        number_limits: fileConfig?.image?.number_limits || 3,
        transfer_methods: fileConfig?.image?.transfer_methods || ['local_file', 'remote_url'],
      },
      enabled: !!(fileConfig?.enabled || fileConfig?.image?.enabled),
      allowed_file_types: fileConfig?.allowed_file_types || [SupportUploadFileTypes.image],
      allowed_file_extensions: fileConfig?.allowed_file_extensions || [...FILE_EXTS[SupportUploadFileTypes.image]].map(ext => `.${ext}`),
      allowed_file_upload_methods: fileConfig?.allowed_file_upload_methods || fileConfig?.image?.transfer_methods || ['local_file', 'remote_url'],
      number_limits: fileConfig?.number_limits || fileConfig?.image?.number_limits || 3,
    }
  }, [currentApp?.model_config?.file_upload, currentWorkflow?.features?.file_upload, isBasicApp])

  const inputFormSchema = useMemo(() => {
    if (!currentApp)
      return []
    let inputFormSchema = []
    if (isBasicApp) {
      inputFormSchema = currentApp.model_config?.user_input_form?.filter((item: any) => !item.external_data_tool).map((item: any) => {
        if (item.paragraph) {
          return {
            ...item.paragraph,
            type: 'paragraph',
            required: false,
          }
        }
        if (item.number) {
          return {
            ...item.number,
            type: 'number',
            required: false,
          }
        }
        if (item.select) {
          return {
            ...item.select,
            type: 'select',
            required: false,
          }
        }

        if (item['file-list']) {
          return {
            ...item['file-list'],
            type: 'file-list',
            required: false,
            fileUploadConfig,
          }
        }

        if (item.file) {
          return {
            ...item.file,
            type: 'file',
            required: false,
            fileUploadConfig,
          }
        }

        return {
          ...item['text-input'],
          type: 'text-input',
          required: false,
        }
      }) || []
    }
    else {
      const startNode = currentWorkflow?.graph?.nodes.find(node => node.data.type === BlockEnum.Start) as any
      inputFormSchema = startNode?.data.variables.map((variable: any) => {
        if (variable.type === InputVarType.multiFiles) {
          return {
            ...variable,
            required: false,
            fileUploadConfig,
          }
        }

        if (variable.type === InputVarType.singleFile) {
          return {
            ...variable,
            required: false,
            fileUploadConfig,
          }
        }
        return {
          ...variable,
          required: false,
        }
      }) || []
    }
    if ((currentApp.mode === 'completion' || currentApp.mode === 'workflow') && basicAppFileConfig.enabled) {
      inputFormSchema.push({
        label: 'Image Upload',
        variable: '#image#',
        type: InputVarType.singleFile,
        required: false,
        ...basicAppFileConfig,
        fileUploadConfig,
      })
    }
    return inputFormSchema || []
  }, [basicAppFileConfig, currentApp, currentWorkflow, fileUploadConfig, isBasicApp])

  const handleFormChange = (value: Record<string, any>) => {
    inputsRef.current = value
    onFormChange(value)
  }

  return (
    <div className={cn('flex max-h-[240px] flex-col rounded-b-2xl border-t border-divider-subtle pb-4')}>
      {isLoading && <div className='pt-3'><Loading type='app' /></div>}
      {!isLoading && (
        <div className='system-sm-semibold mb-2 mt-3 flex h-6 shrink-0 items-center px-4 text-text-secondary'>{t('app.appSelector.params')}</div>
      )}
      {!isLoading && !inputFormSchema.length && (
        <div className='flex h-16 flex-col items-center justify-center'>
          <div className='system-sm-regular text-text-tertiary'>{t('app.appSelector.noParams')}</div>
        </div>
      )}
      {!isLoading && !!inputFormSchema.length && (
        <div className='grow overflow-y-auto'>
          <AppInputsForm
            inputs={value?.inputs || {}}
            inputsRef={inputsRef}
            inputsForms={inputFormSchema}
            onFormChange={handleFormChange}
          />
        </div>
      )}
    </div>
  )
}

export default AppInputsPanel
