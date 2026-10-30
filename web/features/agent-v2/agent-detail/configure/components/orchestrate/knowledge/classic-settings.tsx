'use client'

import type {
  DatasetDetailWithPartialMembersResponse,
  DatasetDocMetadataResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type {
  MetadataFilteringCondition,
  MultipleRetrievalConfig,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import type { KnowledgeValidationResult } from '@/features/agent-v2/agent-composer/knowledge-validation'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { FieldLabel, Field as FormField } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useQueries } from '@tanstack/react-query'
import { intersectionBy, xorBy } from 'es-toolkit/compat'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddKnowledge from '@/app/components/workflow/nodes/knowledge-retrieval/components/add-dataset'
import {
  comparisonOperatorNotRequireValue,
  getOperators,
} from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/condition-list/utils'
import MetadataFilter from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter'
import RetrievalConfig from '@/app/components/workflow/nodes/knowledge-retrieval/components/retrieval-config'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringVariableType,
  MetadataFilteringModeEnum as WorkflowMetadataFilteringModeEnum,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { getMultipleRetrievalConfig } from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import { DATASET_DEFAULT } from '@/config'
import {
  getMetadataConditionsMissingValues,
  useKnowledgeValidationMessage,
} from '@/features/agent-v2/agent-composer/knowledge-validation'
import { consoleQuery } from '@/service/console'
import { RETRIEVE_TYPE } from '@/types/app'

type KnowledgeRetrievalQueryMode = 'agent' | 'custom'
type Props = {
  item: AgentKnowledgeRetrievalItem
  onChange: (patch: Partial<AgentKnowledgeRetrievalItem>) => void
  errors?: KnowledgeValidationResult['byId'][string]
}
const queryModeOptions: KnowledgeRetrievalQueryMode[] = ['agent', 'custom']

const optionCardClassName = cn(
  'flex h-8 flex-1 items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg px-3 py-2 text-center system-sm-regular text-text-secondary transition-colors',
  'hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
  'focus-visible:ring-1 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
  'data-checked:border-[1.5px] data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:font-medium data-checked:text-text-primary data-checked:shadow-xs data-checked:shadow-shadow-shadow-3',
)

const createDefaultRetrievalConfig = (): MultipleRetrievalConfig => ({
  top_k: DATASET_DEFAULT.top_k,
  score_threshold: null,
  reranking_enable: false,
})

const createDefaultMetadataFilteringConditions = () => ({
  logical_operator: LogicalOperator.and,
  conditions: [] as MetadataFilteringCondition[],
})

const withModelDefaults = (config: AgentKnowledgeRetrievalItem['metadataModelConfig']) => ({
  provider: config?.provider ?? '',
  name: config?.name ?? '',
  mode: config?.mode ?? 'chat',
  completion_params: config?.completion_params ?? { temperature: 0.7 },
})

const getSharedMetadata = (datasets: DatasetDetailWithPartialMembersResponse[]) =>
  datasets.length
    ? intersectionBy(...datasets.map((dataset) => dataset.doc_metadata ?? []), (field) =>
        JSON.stringify([field.name, field.type]),
      )
    : []

const isMetadataConditionCompatible = (
  condition: MetadataFilteringCondition,
  field: DatasetDocMetadataResponse,
) => {
  const { type } = field
  if (!getOperators(type).some((operator) => operator === condition.comparison_operator))
    return false
  if (comparisonOperatorNotRequireValue(condition.comparison_operator)) return true
  if (type === MetadataFilteringVariableType.number || type === MetadataFilteringVariableType.time)
    return typeof condition.value === 'number' && Number.isFinite(condition.value)
  if (
    condition.comparison_operator === ComparisonOperator.in ||
    condition.comparison_operator === ComparisonOperator.notIn
  )
    return (
      typeof condition.value === 'string' ||
      (Array.isArray(condition.value) &&
        condition.value.every((value) => typeof value === 'string'))
    )
  return typeof condition.value === 'string'
}

const reconcileMetadataConditions = (
  conditions: AgentKnowledgeRetrievalItem['metadataFilteringConditions'],
  datasets: DatasetDetailWithPartialMembersResponse[],
  previousDatasets: DatasetDetailWithPartialMembersResponse[],
) => {
  // Removing all datasets is an intermediate replacement step; keep conditions until selection.
  if (!conditions || !datasets.length) return conditions
  const metadata = getSharedMetadata(datasets)
  const previousMetadata = getSharedMetadata(previousDatasets)
  return {
    ...conditions,
    conditions: conditions.conditions.flatMap((condition) => {
      const field = metadata.find((field) => field.name === condition.name)
      const previousField = previousMetadata.find((field) => field.name === condition.name)
      return field &&
        (!previousField || previousField.type === field.type) &&
        isMetadataConditionCompatible(condition, field)
        ? [{ ...condition, metadata_id: field.id }]
        : []
    }),
  }
}

const createMetadataCondition = ({
  id,
  name,
  type,
}: DatasetDocMetadataResponse): MetadataFilteringCondition => ({
  id: crypto.randomUUID(),
  metadata_id: id,
  name,
  comparison_operator:
    type === MetadataFilteringVariableType.number
      ? ComparisonOperator.equal
      : ComparisonOperator.is,
})

function ClassicSettingsFields({
  item,
  onChange,
  errors,
  selectedDatasets,
}: Props & { selectedDatasets: DatasetDetailWithPartialMembersResponse[] }) {
  const { t } = useTranslation(['agentV2', 'common'])
  const getValidationMessage = useKnowledgeValidationMessage()
  const [rerankModelOpen, setRerankModelOpen] = useState(false)
  const queryModeLabelId = useId()
  const {
    customQuery = '',
    metadataFilterMode = WorkflowMetadataFilteringModeEnum.disabled,
    metadataFilteringConditions = createDefaultMetadataFilteringConditions(),
    metadataModelConfig,
    multipleRetrievalConfig = createDefaultRetrievalConfig(),
    queryMode = 'agent',
    retrievalMode = RETRIEVE_TYPE.multiWay,
    singleRetrievalConfig,
  } = item
  const { currentModel: currentRerankModel, currentProvider: currentRerankProvider } =
    useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)
  const fallbackRerankModel = {
    provider: currentRerankProvider?.provider,
    model: currentRerankModel?.model,
  }
  const resolveMultipleRetrievalConfig = (
    config: MultipleRetrievalConfig,
    nextSelectedDatasets = selectedDatasets,
    originalDatasets = selectedDatasets,
  ) =>
    getMultipleRetrievalConfig(config, nextSelectedDatasets, originalDatasets, fallbackRerankModel)
  const effectiveMultipleRetrievalConfig =
    retrievalMode === RETRIEVE_TYPE.multiWay && selectedDatasets.length > 0
      ? resolveMultipleRetrievalConfig(multipleRetrievalConfig)
      : multipleRetrievalConfig
  const handleSelectedDatasetsChange = (selected: DatasetDetailWithPartialMembersResponse[]) => {
    const nextDatasets = selected.map(
      (dataset) => selectedDatasets.find((current) => current.id === dataset.id) ?? dataset,
    )
    if (!xorBy(nextDatasets, selectedDatasets, 'id').length) return
    onChange({
      selectedDatasets: nextDatasets,
      metadataFilteringConditions: reconcileMetadataConditions(
        item.metadataFilteringConditions,
        nextDatasets,
        selectedDatasets,
      ),
      multipleRetrievalConfig:
        retrievalMode === RETRIEVE_TYPE.multiWay && nextDatasets.length > 0
          ? resolveMultipleRetrievalConfig(multipleRetrievalConfig, nextDatasets)
          : multipleRetrievalConfig,
    })
  }
  const singleModel = withModelDefaults(singleRetrievalConfig?.model)
  const metadataModel = withModelDefaults(metadataModelConfig)
  const updateMetadataConditions = (patch: Partial<typeof metadataFilteringConditions>) =>
    onChange({ metadataFilteringConditions: { ...metadataFilteringConditions, ...patch } })
  const metadataList = useMemo(() => getSharedMetadata(selectedDatasets), [selectedDatasets])
  const datasetsError = getValidationMessage(errors?.datasets)
  const queryError = getValidationMessage(errors?.query)
  const retrievalError = getValidationMessage(errors?.retrieval)
  const metadataError = getValidationMessage(
    errors?.metadata,
    getMetadataConditionsMissingValues(item)
      .map((condition) => condition.name)
      .join(', '),
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 py-2">
      <div className="flex flex-col gap-1 py-2">
        <div id={queryModeLabelId} className="system-sm-medium text-text-secondary">
          {t(($) => $['agentDetail.configure.knowledgeRetrieval.dialog.query.label'])}
        </div>
        <RadioGroup<KnowledgeRetrievalQueryMode>
          aria-labelledby={queryModeLabelId}
          className="w-full gap-2"
          value={queryMode}
          onValueChange={(nextMode) => {
            if (nextMode) onChange({ queryMode: nextMode })
          }}
        >
          {queryModeOptions.map((mode) => (
            <RadioItem<KnowledgeRetrievalQueryMode>
              key={mode}
              value={mode}
              nativeButton
              render={<button type="button" className={optionCardClassName} />}
            >
              <span className="min-w-0 truncate">
                {t(($) => $[`agentDetail.configure.knowledgeRetrieval.dialog.query.${mode}`])}
              </span>
            </RadioItem>
          ))}
        </RadioGroup>
        {queryMode === 'custom' ? (
          <>
            <FormField className="pt-1">
              <FieldLabel>
                {t(
                  ($) =>
                    $['agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel'],
                )}
              </FieldLabel>
              <Textarea
                aria-label={t(
                  ($) =>
                    $['agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel'],
                )}
                aria-invalid={queryError ? true : undefined}
                className="h-20 resize-none rounded-lg px-3 py-2 system-sm-regular"
                placeholder={t(
                  ($) =>
                    $['agentDetail.configure.knowledgeRetrieval.dialog.query.customPlaceholder'],
                )}
                value={customQuery}
                onValueChange={(nextQuery) => onChange({ customQuery: nextQuery })}
              />
            </FormField>
            <p className="system-xs-regular text-text-tertiary">
              {t(
                ($) => $['agentDetail.configure.knowledgeRetrieval.dialog.query.customDescription'],
              )}
            </p>
            {queryError && (
              <p role="alert" className="system-xs-regular text-text-destructive">
                {queryError}
              </p>
            )}
          </>
        ) : (
          <p className="pt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['agentDetail.configure.knowledgeRetrieval.dialog.query.agentDescription'])}
          </p>
        )}
      </div>

      <div className="py-2">
        <Field
          title={t(($) => $['agentDetail.configure.knowledgeRetrieval.dialog.knowledge.label'])}
          required
          operations={
            <div className="flex items-center space-x-1">
              <RetrievalConfig
                preserveRetrievalMode
                payload={{
                  retrieval_mode: retrievalMode,
                  multiple_retrieval_config: effectiveMultipleRetrievalConfig,
                  single_retrieval_config: singleRetrievalConfig,
                }}
                onRetrievalModeChange={(nextRetrievalMode) => {
                  onChange({
                    multipleRetrievalConfig:
                      nextRetrievalMode === RETRIEVE_TYPE.multiWay
                        ? resolveMultipleRetrievalConfig(multipleRetrievalConfig)
                        : multipleRetrievalConfig,
                    retrievalMode: nextRetrievalMode,
                  })
                }}
                onMultipleRetrievalConfigChange={(nextMultipleRetrievalConfig) => {
                  onChange({
                    multipleRetrievalConfig: resolveMultipleRetrievalConfig(
                      nextMultipleRetrievalConfig,
                    ),
                  })
                }}
                singleRetrievalModelConfig={singleRetrievalConfig?.model}
                onSingleRetrievalModelChange={(model) => {
                  onChange({
                    singleRetrievalConfig: {
                      model: {
                        ...singleModel,
                        provider: model.provider,
                        name: model.modelId,
                        mode: model.mode ?? singleModel.mode,
                      },
                    },
                  })
                }}
                onSingleRetrievalModelParamsChange={(completionParams) => {
                  onChange({
                    singleRetrievalConfig: {
                      model: { ...singleModel, completion_params: completionParams },
                    },
                  })
                }}
                readonly={!selectedDatasets.length}
                modal
                rerankModalOpen={rerankModelOpen}
                onRerankModelOpenChange={setRerankModelOpen}
                selectedDatasets={selectedDatasets}
              />
              <div className="h-3 w-px bg-divider-regular" />
              <AddKnowledge
                key={selectedDatasets.map((dataset) => dataset.id).join(',')}
                selectedIds={selectedDatasets.map((dataset) => dataset.id)}
                modal
                onChange={handleSelectedDatasetsChange}
              />
            </div>
          }
        >
          <>
            <ul className="space-y-1 system-xs-regular text-text-secondary">
              {selectedDatasets.map((dataset) => (
                <li key={dataset.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 wrap-break-word">{dataset.name}</span>
                  <IconButton
                    aria-label={`${t(($) => $['operation.remove'], { ns: 'common' })} ${dataset.name}`}
                    onClick={() =>
                      handleSelectedDatasetsChange(
                        selectedDatasets.filter((current) => current.id !== dataset.id),
                      )
                    }
                  >
                    <span aria-hidden className="i-ri-delete-bin-line size-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
            {(datasetsError || retrievalError) && (
              <div role="alert" className="pt-2 system-xs-regular text-text-destructive">
                {datasetsError ?? retrievalError}
              </div>
            )}
          </>
        </Field>
      </div>

      {/* The shared workflow filter brings its own px-4 gutter; cancel it to line up with the fields above. */}
      <div className="-mx-4 py-2">
        {/* Keep saved conditions until an explicit edit; catalog loading must not prune them. */}
        <MetadataFilter
          metadataList={metadataList}
          metadataFilterMode={metadataFilterMode}
          metadataFilteringConditions={metadataFilteringConditions}
          handleMetadataFilterModeChange={(nextMode) => onChange({ metadataFilterMode: nextMode })}
          handleAddCondition={(metadataItem) =>
            updateMetadataConditions({
              conditions: [
                ...metadataFilteringConditions.conditions,
                createMetadataCondition(metadataItem),
              ],
            })
          }
          handleRemoveCondition={(conditionId) =>
            updateMetadataConditions({
              conditions: metadataFilteringConditions.conditions.filter(
                (condition) => condition.id !== conditionId,
              ),
            })
          }
          handleToggleConditionLogicalOperator={() =>
            updateMetadataConditions({
              logical_operator:
                metadataFilteringConditions.logical_operator === LogicalOperator.and
                  ? LogicalOperator.or
                  : LogicalOperator.and,
            })
          }
          handleUpdateCondition={(conditionId, nextCondition) =>
            updateMetadataConditions({
              conditions: metadataFilteringConditions.conditions.map((condition) =>
                condition.id === conditionId ? nextCondition : condition,
              ),
            })
          }
          metadataModelConfig={metadataModelConfig}
          handleMetadataModelChange={(model) => {
            onChange({
              metadataModelConfig: {
                ...metadataModel,
                provider: model.provider,
                name: model.modelId,
                mode: model.mode ?? metadataModel.mode,
              },
            })
          }}
          handleMetadataCompletionParamsChange={(completionParams) => {
            onChange({
              metadataModelConfig: { ...metadataModel, completion_params: completionParams },
            })
          }}
        />
        {metadataError && (
          <div role="alert" className="px-4 pt-2 system-xs-regular text-text-destructive">
            {metadataError}
          </div>
        )}
      </div>
    </div>
  )
}

/** Only mounted inside the shared binding dialog's advanced settings. */
export function ClassicKnowledgeSettings({ item, onChange, errors }: Props) {
  const { t } = useTranslation(['common'])
  const ids = item.datasetRefs?.flatMap((dataset) => (dataset.id ? [dataset.id] : [])) ?? []
  const queries = useQueries({
    queries: (item.selectedDatasets === undefined ? ids : []).map((id) =>
      consoleQuery.datasets.byDatasetId.get.queryOptions({ input: { params: { dataset_id: id } } }),
    ),
  })
  const datasets =
    item.selectedDatasets ?? queries.flatMap((query) => (query.data ? [query.data] : []))
  const removeFailedDataset = (id: string) => {
    const datasetRefs = item.datasetRefs?.filter((dataset) => dataset.id !== id)
    const remainingDatasets = queries.flatMap((query) =>
      query.isSuccess && query.data.id !== id ? [query.data] : [],
    )
    const allResolved = ids
      .filter((current) => current !== id)
      .every((current) => remainingDatasets.some((dataset) => dataset.id === current))
    onChange({
      datasetRefs,
      ...(allResolved
        ? {
            selectedDatasets: remainingDatasets,
            metadataFilteringConditions: reconcileMetadataConditions(
              item.metadataFilteringConditions,
              remainingDatasets,
              datasets,
            ),
          }
        : {}),
    })
  }
  if (queries.some((query) => query.isPending))
    return (
      <div role="status" className="h-16 animate-pulse rounded-lg bg-background-default">
        <span className="sr-only">{t(($) => $.loading)}</span>
      </div>
    )
  if (queries.some((query) => query.isError))
    return (
      <div className="space-y-2">
        <p role="alert" className="text-text-destructive">
          {t(($) => $.error)}
        </p>
        <Button
          onClick={() => {
            queries.forEach((query) => {
              void query.refetch()
            })
          }}
        >
          {t(($) => $['operation.retry'])}
        </Button>
        <ul className="space-y-1">
          {ids
            .filter((_, index) => queries[index]?.isError)
            .map((id) => {
              const name = item.datasetRefs?.find((dataset) => dataset.id === id)?.name || id
              return (
                <li key={id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 system-xs-regular wrap-break-word text-text-secondary">
                    {name}
                  </span>
                  <Button
                    size="small"
                    aria-label={`${t(($) => $['operation.remove'])} ${name}`}
                    onClick={() => removeFailedDataset(id)}
                  >
                    {t(($) => $['operation.remove'])}
                  </Button>
                </li>
              )
            })}
        </ul>
      </div>
    )
  return (
    <ClassicSettingsFields
      item={item}
      onChange={onChange}
      errors={errors}
      selectedDatasets={datasets}
    />
  )
}
