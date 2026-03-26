import type { HttpMethod, WebhookHeader, WebhookParameter, WebhookTriggerNodeType } from './types'
import type { Variable } from '@/app/components/workflow/types'
import { produce } from 'immer'
import { VarType } from '@/app/components/workflow/types'
import { checkKeys, hasDuplicateStr } from '@/utils/var'
import { WEBHOOK_RAW_VARIABLE_NAME } from './utils/raw-variable'

export type VariableSyncSource = 'param' | 'header' | 'body'

type SanitizedEntry = {
  item: WebhookParameter | WebhookHeader
  sanitizedName: string
}

type NotifyError = (key: string) => void

const sanitizeEntryName = (item: WebhookParameter | WebhookHeader, sourceType: VariableSyncSource) => {
  return sourceType === 'header' ? item.name.replace(/-/g, '_') : item.name
}

const getSanitizedEntries = (
  newData: (WebhookParameter | WebhookHeader)[],
  sourceType: VariableSyncSource,
): SanitizedEntry[] => {
  return newData.map(item => ({
    item,
    sanitizedName: sanitizeEntryName(item, sourceType),
  }))
}

const createVariable = (
  item: WebhookParameter | WebhookHeader,
  sourceType: VariableSyncSource,
  sanitizedName: string,
): Variable => {
  const inputVarType: VarType = 'type' in item ? item.type : VarType.string

  return {
    value_type: inputVarType,
    label: sourceType,
    variable: sanitizedName,
    value_selector: [],
    required: item.required,
  }
}

export const syncVariables = ({
  draft,
  id,
  newData,
  sourceType,
  notifyError,
  isVarUsedInNodes,
  removeUsedVarInNodes,
}: {
  draft: WebhookTriggerNodeType
  id: string
  newData: (WebhookParameter | WebhookHeader)[]
  sourceType: VariableSyncSource
  notifyError: NotifyError
  isVarUsedInNodes: (selector: [string, string]) => boolean
  removeUsedVarInNodes: (selector: [string, string]) => void
}) => {
  if (!draft.variables)
    draft.variables = []

  const sanitizedEntries = getSanitizedEntries(newData, sourceType)
  if (sanitizedEntries.some(entry => entry.sanitizedName === WEBHOOK_RAW_VARIABLE_NAME)) {
    notifyError('variableConfig.varName')
    return false
  }

  const existingOtherVarNames = new Set(
    draft.variables
      .filter(v => v.label !== sourceType && v.variable !== WEBHOOK_RAW_VARIABLE_NAME)
      .map(v => v.variable),
  )

  const crossScopeConflict = sanitizedEntries.find(entry => existingOtherVarNames.has(entry.sanitizedName))
  if (crossScopeConflict) {
    notifyError(crossScopeConflict.sanitizedName)
    return false
  }

  if (hasDuplicateStr(sanitizedEntries.map(entry => entry.sanitizedName))) {
    notifyError('variableConfig.varName')
    return false
  }

  for (const { sanitizedName } of sanitizedEntries) {
    const { isValid, errorMessageKey } = checkKeys([sanitizedName], false)
    if (!isValid) {
      notifyError(`varKeyError.${errorMessageKey}`)
      return false
    }
  }

  const nextNames = new Set(sanitizedEntries.map(entry => entry.sanitizedName))
  draft.variables
    .filter(v => v.label === sourceType && !nextNames.has(v.variable))
    .forEach((variable) => {
      if (isVarUsedInNodes([id, variable.variable]))
        removeUsedVarInNodes([id, variable.variable])
    })

  draft.variables = draft.variables.filter((variable) => {
    if (variable.label !== sourceType)
      return true
    return nextNames.has(variable.variable)
  })

  sanitizedEntries.forEach(({ item, sanitizedName }) => {
    const existingVarIndex = draft.variables.findIndex(v => v.variable === sanitizedName)
    const variable = createVariable(item, sourceType, sanitizedName)
    if (existingVarIndex >= 0)
      draft.variables[existingVarIndex] = variable
    else
      draft.variables.push(variable)
  })

  return true
}

export const updateMethod = (inputs: WebhookTriggerNodeType, method: HttpMethod) => produce(inputs, (draft) => {
  draft.method = method
})

export const updateSimpleField = <
  K extends 'async_mode' | 'status_code' | 'response_body',
>(
  inputs: WebhookTriggerNodeType,
  key: K,
  value: WebhookTriggerNodeType[K],
) => produce(inputs, (draft) => {
  draft[key] = value
})

export const updateContentType = ({
  inputs,
  id,
  contentType,
  isVarUsedInNodes,
  removeUsedVarInNodes,
}: {
  inputs: WebhookTriggerNodeType
  id: string
  contentType: string
  isVarUsedInNodes: (selector: [string, string]) => boolean
  removeUsedVarInNodes: (selector: [string, string]) => void
}) => produce(inputs, (draft) => {
  const previousContentType = draft.content_type
  draft.content_type = contentType

  if (previousContentType === contentType)
    return

  draft.body = []
  if (!draft.variables)
    return

  draft.variables
    .filter(v => v.label === 'body')
    .forEach((variable) => {
      if (isVarUsedInNodes([id, variable.variable]))
        removeUsedVarInNodes([id, variable.variable])
    })

  draft.variables = draft.variables.filter(v => v.label !== 'body')
})

type SourceField = 'params' | 'headers' | 'body'

const getSourceField = (sourceType: VariableSyncSource): SourceField => {
  switch (sourceType) {
    case 'param':
      return 'params'
    case 'header':
      return 'headers'
    default:
      return 'body'
  }
}

export const updateSourceFields = ({
  inputs,
  id,
  sourceType,
  nextData,
  notifyError,
  isVarUsedInNodes,
  removeUsedVarInNodes,
}: {
  inputs: WebhookTriggerNodeType
  id: string
  sourceType: VariableSyncSource
  nextData: WebhookParameter[] | WebhookHeader[]
  notifyError: NotifyError
  isVarUsedInNodes: (selector: [string, string]) => boolean
  removeUsedVarInNodes: (selector: [string, string]) => void
}) => produce(inputs, (draft) => {
  draft[getSourceField(sourceType)] = nextData as never
  syncVariables({
    draft,
    id,
    newData: nextData,
    sourceType,
    notifyError,
    isVarUsedInNodes,
    removeUsedVarInNodes,
  })
})

export const updateWebhookUrls = (
  inputs: WebhookTriggerNodeType,
  webhookUrl: string,
  webhookDebugUrl?: string,
) => produce(inputs, (draft) => {
  draft.webhook_url = webhookUrl
  draft.webhook_debug_url = webhookDebugUrl
})
