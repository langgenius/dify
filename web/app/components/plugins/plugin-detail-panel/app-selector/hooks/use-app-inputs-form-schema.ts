'use client'

import type {
  AppDetailWithSite,
  AppPartial,
  WorkflowResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { UploadConfig } from '@dify/contracts/api/console/files/types.gen'
import type { FileUpload } from '@/app/components/base/features/types'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { BlockEnum, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { useAppWorkflow } from '@/service/use-workflow'
import { Resolution } from '@/types/app'

const BASIC_INPUT_TYPE_MAP: Record<string, string> = {
  paragraph: 'paragraph',
  number: 'number',
  checkbox: 'checkbox',
  select: 'select',
  'file-list': 'file-list',
  file: 'file',
  json_object: 'json_object',
}

const FILE_INPUT_TYPES = new Set(['file-list', 'file'])

const WORKFLOW_FILE_VAR_TYPES = new Set<InputVarType>([
  InputVarType.multiFiles,
  InputVarType.singleFile,
])

type InputSchemaItem = {
  label?: string
  variable?: string
  type: string
  required: boolean
  fileUploadConfig?: UploadConfig
  [key: string]: unknown
}

type WorkflowNodeWithVariables = {
  data: {
    type: BlockEnum
    variables?: Array<Record<string, unknown>>
  }
}

function isBasicAppMode(mode: string): boolean {
  return mode !== 'advanced-chat' && mode !== 'workflow'
}

function supportsImageUpload(mode: string): boolean {
  return mode === 'completion' || mode === 'workflow'
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
    allowed_file_extensions:
      fileConfig?.allowed_file_extensions ||
      [...(FILE_EXTS[SupportUploadFileTypes.image] ?? [])].map((ext) => `.${ext}`),
    allowed_file_upload_methods: fileConfig?.allowed_file_upload_methods ||
      fileConfig?.image?.transfer_methods || ['local_file', 'remote_url'],
    number_limits: fileConfig?.number_limits || fileConfig?.image?.number_limits || 3,
  }
}

function mapBasicAppInputItem(
  item: Record<string, unknown>,
  fileUploadConfig?: UploadConfig,
): InputSchemaItem | null {
  for (const [key, type] of Object.entries(BASIC_INPUT_TYPE_MAP)) {
    if (!item[key]) continue

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
  if (!textInput) return null

  return {
    ...textInput,
    type: 'text-input',
    required: false,
  }
}

function mapWorkflowVariable(
  variable: Record<string, unknown>,
  fileUploadConfig?: UploadConfig,
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
  fileUploadConfig?: UploadConfig,
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
  currentApp: AppDetailWithSite,
  fileUploadConfig?: UploadConfig,
): InputSchemaItem[] {
  const userInputForm = currentApp.model_config?.user_input_form as
    | Array<Record<string, unknown>>
    | undefined
  if (!userInputForm) return []

  return userInputForm
    .filter((item: Record<string, unknown>) => !item.external_data_tool)
    .map((item: Record<string, unknown>) => mapBasicAppInputItem(item, fileUploadConfig))
    .filter((item): item is InputSchemaItem => item !== null)
}

function buildWorkflowSchema(
  workflow: Pick<WorkflowResponse, 'graph'>,
  fileUploadConfig?: UploadConfig,
): InputSchemaItem[] {
  const nodes = workflow.graph.nodes
  if (!Array.isArray(nodes)) return []

  const startNode = (nodes as WorkflowNodeWithVariables[]).find(
    (node) => node.data.type === BlockEnum.Start,
  )

  if (!startNode?.data.variables) return []

  return startNode.data.variables.map((variable) => mapWorkflowVariable(variable, fileUploadConfig))
}

type UseAppInputsFormSchemaParams = {
  appDetail: Pick<AppPartial, 'id' | 'mode'>
}

type UseAppInputsFormSchemaResult = {
  inputFormSchema: InputSchemaItem[]
  isError: boolean
  isLoading: boolean
  retry: () => void
  fileUploadConfig?: UploadConfig
}

export function useAppInputsFormSchema({
  appDetail,
}: UseAppInputsFormSchemaParams): UseAppInputsFormSchemaResult {
  const isBasicApp = isBasicAppMode(appDetail.mode)

  const fileUploadConfigQuery = useQuery(consoleQuery.files.upload.get.queryOptions())
  const { data: fileUploadConfig } = fileUploadConfigQuery
  const appQuery = useQuery(
    consoleQuery.apps.byAppId.get.queryOptions({
      input: { params: { app_id: appDetail.id } },
    }),
  )
  const { data: currentApp } = appQuery
  const workflowQuery = useAppWorkflow(isBasicApp ? '' : appDetail.id)
  const { data: currentWorkflow } = workflowQuery

  const isLoading = appQuery.isFetching || workflowQuery.isFetching
  const isError = appQuery.isError || workflowQuery.isError

  const inputFormSchema = useMemo(() => {
    if (!currentApp) return []

    if (!isBasicApp && !currentWorkflow) return []

    // Build base schema based on app type
    // Note: currentWorkflow is guaranteed to be defined here due to the early return above
    const baseSchema = isBasicApp
      ? buildBasicAppSchema(currentApp, fileUploadConfig)
      : buildWorkflowSchema(currentWorkflow!, fileUploadConfig)

    if (!supportsImageUpload(currentApp.mode)) return baseSchema

    const rawFileConfig = isBasicApp
      ? (currentApp.model_config?.file_upload as FileUpload)
      : (currentWorkflow?.features?.file_upload as FileUpload)

    const basicFileConfig = buildFileConfig(rawFileConfig)

    if (!basicFileConfig.enabled) return baseSchema

    return [...baseSchema, createImageUploadSchema(basicFileConfig, fileUploadConfig)]
  }, [currentApp, currentWorkflow, fileUploadConfig, isBasicApp])

  const retry = () => {
    void Promise.all([
      fileUploadConfigQuery.refetch(),
      appQuery.refetch(),
      ...(!isBasicApp ? [workflowQuery.refetch()] : []),
    ])
  }

  return {
    inputFormSchema,
    isError,
    isLoading,
    retry,
    fileUploadConfig,
  }
}
