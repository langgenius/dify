import type { AgentKnowledgeRetrievalItem } from './form-state'
import { useTranslation } from 'react-i18next'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { RETRIEVE_TYPE } from '@/types/app'

export type KnowledgeValidationIssueCode =
  | 'name_required'
  | 'name_duplicate'
  | 'datasets_required'
  | 'custom_query_required'
  | 'single_model_required'
  | 'metadata_model_required'
  | 'metadata_conditions_required'

type KnowledgeValidationField = 'name' | 'datasets' | 'query' | 'retrieval' | 'metadata'

type KnowledgeValidationIssue = {
  itemId: string
  code: KnowledgeValidationIssueCode
  field: KnowledgeValidationField
}

export type KnowledgeValidationResult = {
  byId: Record<string, Partial<Record<KnowledgeValidationField, KnowledgeValidationIssueCode>>>
  firstIssue?: KnowledgeValidationIssue
  isValid: boolean
}

const getKnowledgeRetrievalConcreteName = (item: AgentKnowledgeRetrievalItem) =>
  item.name?.trim() ?? ''

export const getKnowledgeRetrievalSetName = (item: AgentKnowledgeRetrievalItem) =>
  getKnowledgeRetrievalConcreteName(item) || item.id

export const useKnowledgeValidationMessage = () => {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const { t: tAppDebug } = useTranslation('appDebug')
  const { t: tWorkflow } = useTranslation('workflow')

  return (issueCode?: KnowledgeValidationIssueCode) => {
    switch (issueCode) {
      case 'name_required':
        return tCommon(($) => $['errorMsg.fieldRequired'], {
          field: t(($) => $['agentDetail.configure.knowledgeRetrieval.dialog.nameLabel']),
        })
      case 'name_duplicate':
        return tAppDebug(($) => $['varKeyError.keyAlreadyExists'], {
          key: t(($) => $['agentDetail.configure.knowledgeRetrieval.dialog.nameLabel']),
        })
      case 'datasets_required':
        return tCommon(($) => $['errorMsg.fieldRequired'], {
          field: t(($) => $['agentDetail.configure.knowledgeRetrieval.dialog.knowledge.label']),
        })
      case 'custom_query_required':
        return tCommon(($) => $['errorMsg.fieldRequired'], {
          field: t(
            ($) => $['agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel'],
          ),
        })
      case 'single_model_required':
        return tCommon(($) => $['errorMsg.fieldRequired'], {
          field: tCommon(($) => $['modelProvider.systemReasoningModel.key']),
        })
      case 'metadata_model_required':
        return t(
          ($) => $['agentDetail.configure.knowledgeRetrieval.validation.metadataModelRequired'],
        )
      case 'metadata_conditions_required':
        return tCommon(($) => $['errorMsg.fieldRequired'], {
          field: tWorkflow(($) => $['nodes.knowledgeRetrieval.metadata.panel.conditions']),
        })
      default:
        return undefined
    }
  }
}

const getKnowledgeDatasetCount = (item: AgentKnowledgeRetrievalItem) =>
  item.selectedDatasets?.length ?? item.datasetRefs?.length ?? 0

const getNormalizedKnowledgeName = (item: AgentKnowledgeRetrievalItem) =>
  getKnowledgeRetrievalConcreteName(item).toLowerCase()

export const validateKnowledgeRetrievals = (
  retrievals: AgentKnowledgeRetrievalItem[],
): KnowledgeValidationResult => {
  const byId: KnowledgeValidationResult['byId'] = {}
  const issues: KnowledgeValidationIssue[] = []
  const nameCounts = new Map<string, number>()

  retrievals.forEach((item) => {
    const normalizedName = getNormalizedKnowledgeName(item)
    if (!normalizedName) return

    nameCounts.set(normalizedName, (nameCounts.get(normalizedName) ?? 0) + 1)
  })

  const pushIssue = (issue: KnowledgeValidationIssue) => {
    byId[issue.itemId] ??= {}
    const itemIssues = byId[issue.itemId]
    if (itemIssues) itemIssues[issue.field] ??= issue.code
    issues.push(issue)
  }

  retrievals.forEach((item) => {
    const setName = getKnowledgeRetrievalConcreteName(item)
    const normalizedName = setName.toLowerCase()

    if (!setName) {
      pushIssue({
        itemId: item.id,
        code: 'name_required',
        field: 'name',
      })
    } else if ((nameCounts.get(normalizedName) ?? 0) > 1) {
      pushIssue({
        itemId: item.id,
        code: 'name_duplicate',
        field: 'name',
      })
    }

    if (!getKnowledgeDatasetCount(item)) {
      pushIssue({
        itemId: item.id,
        code: 'datasets_required',
        field: 'datasets',
      })
    }

    if (item.queryMode === 'custom' && !item.customQuery?.trim()) {
      pushIssue({
        itemId: item.id,
        code: 'custom_query_required',
        field: 'query',
      })
    }

    if (
      item.retrievalMode === RETRIEVE_TYPE.oneWay &&
      (!item.singleRetrievalConfig?.model?.provider || !item.singleRetrievalConfig.model.name)
    ) {
      pushIssue({
        itemId: item.id,
        code: 'single_model_required',
        field: 'retrieval',
      })
    }

    if (
      item.metadataFilterMode === MetadataFilteringModeEnum.automatic &&
      (!item.metadataModelConfig?.provider || !item.metadataModelConfig.name)
    ) {
      pushIssue({
        itemId: item.id,
        code: 'metadata_model_required',
        field: 'metadata',
      })
    }

    if (
      item.metadataFilterMode === MetadataFilteringModeEnum.manual &&
      !item.metadataFilteringConditions?.conditions.length
    ) {
      pushIssue({
        itemId: item.id,
        code: 'metadata_conditions_required',
        field: 'metadata',
      })
    }
  })

  return {
    byId,
    firstIssue: issues[0],
    isValid: issues.length === 0,
  }
}
