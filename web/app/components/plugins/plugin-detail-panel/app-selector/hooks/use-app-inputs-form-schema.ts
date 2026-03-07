'use client'
import type { FileUpload } from '@/app/components/base/features/types'
import type { FileUploadConfigResponse } from '@/models/common'
import type { App } from '@/types/app'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'
import { useMemo } from 'react'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { BlockEnum, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { useAppDetail } from '@/service/use-apps'
import { useFileUploadConfig } from '@/service/use-common'
import { useAppWorkflow } from '@/service/use-workflow'
import { AppModeEnum, Resolution } from '@/types/app'

const BASIC_INPUT_TYPE_MAP: Record<string, string> = {
  'paragraph': 'paragraph',
  'number': 'number',
  'checkbox': 'checkbox',
  'select': 'select',
  'file-list': 'file-list',
  'file': 'file',
  'json_object': 'json_object',
}

const FILE_INPUT_TYPES = new Set(['file-list', 'file'])

const WORKFLOW_FILE_VAR_TYPES = new Set([InputVarType.multiFiles, InputVarType.singleFile])

type InputSchemaItem = {
  label?: string
  variable?: string
  type: string
  required: boolean
  fileUploadConfig?: FileUploadConfigResponse
  [key: string]: unknown
}

function isBasicAppMode(mode: string): boolean {
  return mode !== AppModeEnum.ADVANCED_CHAT && mode !== AppModeEnum.WORKFLOW
}

function supportsImageUpload(mode: string): boolean {
  return mode === AppModeEnum.COMPLETION || mode === AppModeEnum.WORKFLOW
}

function buildFileConfig(fileConfig: FileUpload | undefined) {
  return {
    image: {
      detail: fileConfig?.image?.detail || Resolution.high,
      enabled: !!fileConfig?.image?.enabled,
      number_limits: fileConfig?.image?.number_limits || 3,
      transfer_methods: fileConfig?.image?.transfer_methods || ['local_file', 'remote_url'],
    },
    enabled: !!(fileConfig?.enabled || fileConfig?.image?.enabled),
    allowed_file_types: fileConfig?.allowed_file_types || [SupportUploadFileTypes.image],
    allowed_file_extensions: fileConfig?.allowed_file_extensions
      || [...FILE_EXTS[SupportUploadFileTypes.image]].map(ext => `.${ext}`),
    allowed_file_upload_methods: fileConfig?.allowed_file_upload_methods
      || fileConfig?.image?.transfer_methods
      || ['local_file', 'remote_url'],
    number_limits: fileConfig?.number_limits || fileConfig?.image?.number_limits || 3,
  }
}

function mapBasicAppInputItem(
  item: Record<string, unknown>,
  fileUploadConfig?: FileUploadConfigResponse,
): InputSchemaItem | null {
  for (const [key, type] of Object.entries(BASIC_INPUT_TYPE_MAP)) {
    if (!item[key])
      continue

    const inputData = item[key] as Record<string, unknown>
    const needsFileConfig = FILE_INPUT_TYPES.has(key)

    return {
      ...inputData,
      type,
      required: false,
      ...(needsFileConfig && { fileUploadConfig }),
    }
  }

  const textInput = item['text-input'] as Record<string, unknown> | undefined
  if (!textInput)
    return null

  return {
    ...textInput,
    type: 'text-input',
    required: false,
  }
}

function mapWorkflowVariable(
  variable: Record<string, unknown>,
  fileUploadConfig?: FileUploadConfigResponse,
): InputSchemaItem {
  const needsFileConfig = WORKFLOW_FILE_VAR_TYPES.has(variable.type as InputVarType)

  return {
    ...variable,
    type: variable.type as string,
    required: false,
    ...(needsFileConfig && { fileUploadConfig }),
  }
}

function createImageUploadSchema(
  basicFileConfig: ReturnType<typeof buildFileConfig>,
  fileUploadConfig?: FileUploadConfigResponse,
): InputSchemaItem {
  return {
    label: 'Image Upload',
    variable: '#image#',
    type: InputVarType.singleFile,
    required: false,
    ...basicFileConfig,
    fileUploadConfig,
  }
}

function buildBasicAppSchema(
  currentApp: App,
  fileUploadConfig?: FileUploadConfigResponse,
): InputSchemaItem[] {
  const userInputForm = currentApp.model_config?.user_input_form as Array<Record<string, unknown>> | undefined
  if (!userInputForm)
    return []

  return userInputForm
    .filter((item: Record<string, unknown>) => !item.external_data_tool)
    .map((item: Record<string, unknown>) => mapBasicAppInputItem(item, fileUploadConfig))
    .filter((item): item is InputSchemaItem => item !== null)
}

function buildWorkflowSchema(
  workflow: FetchWorkflowDraftResponse,
  fileUploadConfig?: FileUploadConfigResponse,
): InputSchemaItem[] {
  const startNode = workflow.graph?.nodes.find(
    node => node.data.type === BlockEnum.Start,
  ) as { data: { variables: Array<Record<string, unknown>> } } | undefined

  if (!startNode?.data.variables)
    return []

  return startNode.data.variables.map(
    variable => mapWorkflowVariable(variable, fileUploadConfig),
  )
}

type UseAppInputsFormSchemaParams = {
  appDetail: App
}

type UseAppInputsFormSchemaResult = {
  inputFormSchema: InputSchemaItem[]
  isLoading: boolean
  fileUploadConfig?: FileUploadConfigResponse
}

export function useAppInputsFormSchema({
  appDetail,
}: UseAppInputsFormSchemaParams): UseAppInputsFormSchemaResult {
  const isBasicApp = isBasicAppMode(appDetail.mode)

  const { data: fileUploadConfig } = useFileUploadConfig()
  const { data: currentApp, isFetching: isAppLoading } = useAppDetail(appDetail.id)
  const { data: currentWorkflow, isFetching: isWorkflowLoading } = useAppWorkflow(
    isBasicApp ? '' : appDetail.id,
  )

  const isLoading = isAppLoading || isWorkflowLoading

  const inputFormSchema = useMemo(() => {
    if (!currentApp)
      return []

    if (!isBasicApp && !currentWorkflow)
      return []

    // Build base schema based on app type
    // Note: currentWorkflow is guaranteed to be defined here due to the early return above
    const baseSchema = isBasicApp
      ? buildBasicAppSchema(currentApp, fileUploadConfig)
      : buildWorkflowSchema(currentWorkflow!, fileUploadConfig)

    if (!supportsImageUpload(currentApp.mode))
      return baseSchema

    const rawFileConfig = isBasicApp
      ? currentApp.model_config?.file_upload as FileUpload
      : currentWorkflow?.features?.file_upload as FileUpload

    const basicFileConfig = buildFileConfig(rawFileConfig)

    if (!basicFileConfig.enabled)
      return baseSchema

    return [
      ...baseSchema,
      createImageUploadSchema(basicFileConfig, fileUploadConfig),
    ]
  }, [currentApp, currentWorkflow, fileUploadConfig, isBasicApp])

  return {
    inputFormSchema,
    isLoading,
    fileUploadConfig,
  }
}
