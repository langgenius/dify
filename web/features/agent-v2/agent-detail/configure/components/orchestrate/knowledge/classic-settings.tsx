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
import type { KnowledgeValidationIssueCode } from '@/features/agent-v2/agent-composer/knowledge-validation'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { FieldLabel, Field as FormField } from '@langgenius/dify-ui/field'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useQueries } from '@tanstack/react-query'
import { intersectionBy } from 'es-toolkit/compat'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useCurrentProviderAndModel,
  useModelListAndDefaultModelAndCurrentProviderAndModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddKnowledge from '@/app/components/workflow/nodes/knowledge-retrieval/components/add-dataset'
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
import { useKnowledgeValidationMessage } from '@/features/agent-v2/agent-composer/knowledge-validation'
import { consoleQuery } from '@/service/console'
import { RETRIEVE_TYPE } from '@/types/app'

type KnowledgeRetrievalQueryMode = 'agent' | 'custom'
type Props = {
  item: AgentKnowledgeRetrievalItem
  onChange: (patch: Partial<AgentKnowledgeRetrievalItem>) => void
  errors?: Partial<
    Record<'name' | 'datasets' | 'query' | 'retrieval' | 'metadata', KnowledgeValidationIssueCode>
  >
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

const createMetadataCondition = ({
  id,
  name,
  type,
}: DatasetDocMetadataResponse): MetadataFilteringCondition => ({
  id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
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
  const { t } = useTranslation(['agentV2'])
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
  const { modelList: rerankModelList, defaultModel: rerankDefaultModel } =
    useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)
  const { currentModel: currentRerankModel, currentProvider: currentRerankProvider } =
    useCurrentProviderAndModel(
      rerankModelList,
      rerankDefaultModel
        ? {
            ...rerankDefaultModel,
            provider: rerankDefaultModel.provider.provider,
          }
        : undefined,
    )
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
    onChange({
      selectedDatasets: nextDatasets,
      multipleRetrievalConfig:
        retrievalMode === RETRIEVE_TYPE.multiWay && nextDatasets.length > 0
          ? resolveMultipleRetrievalConfig(multipleRetrievalConfig, nextDatasets)
          : multipleRetrievalConfig,
    })
  }
  const metadataList = useMemo(() => {
    const datasetsWithMetadata = selectedDatasets.filter((dataset) => !!dataset.doc_metadata)

    if (datasetsWithMetadata.length === 0) return []

    return intersectionBy(...datasetsWithMetadata.map((dataset) => dataset.doc_metadata!), 'name')
  }, [selectedDatasets])
  const datasetsError = getValidationMessage(errors?.datasets)
  const queryError = getValidationMessage(errors?.query)
  const retrievalError = getValidationMessage(errors?.retrieval)
  const metadataError = getValidationMessage(errors?.metadata)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 py-2">
      <div className="flex flex-col gap-1 px-4 py-2">
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

      <div className="px-4 py-2">
        <Field
          title={t(($) => $['agentDetail.configure.knowledgeRetrieval.dialog.knowledge.label'])}
          required
          operations={
            <div className="flex items-center space-x-1">
              <RetrievalConfig
                payload={{
                  retrieval_mode: retrievalMode,
                  multiple_retrieval_config: effectiveMultipleRetrievalConfig,
                  single_retrieval_config: singleRetrievalConfig,
                }}
                onRetrievalModeChange={(nextRetrievalMode) => {
                  const nextMultipleRetrievalConfig =
                    nextRetrievalMode === RETRIEVE_TYPE.multiWay
                      ? resolveMultipleRetrievalConfig(multipleRetrievalConfig)
                      : multipleRetrievalConfig

                  onChange({
                    multipleRetrievalConfig: nextMultipleRetrievalConfig,
                    retrievalMode: nextRetrievalMode,
                  })
                }}
                onMultipleRetrievalConfigChange={(nextMultipleRetrievalConfig) => {
                  const normalizedMultipleRetrievalConfig = resolveMultipleRetrievalConfig(
                    nextMultipleRetrievalConfig,
                  )

                  onChange({
                    multipleRetrievalConfig: normalizedMultipleRetrievalConfig,
                  })
                }}
                singleRetrievalModelConfig={singleRetrievalConfig?.model}
                onSingleRetrievalModelChange={(model) => {
                  onChange({
                    singleRetrievalConfig: {
                      model: {
                        provider: model.provider,
                        name: model.modelId,
                        mode: model.mode ?? singleRetrievalConfig?.model.mode ?? 'chat',
                        completion_params: singleRetrievalConfig?.model.completion_params ?? {
                          temperature: 0.7,
                        },
                      },
                    },
                  })
                }}
                onSingleRetrievalModelParamsChange={(completionParams) => {
                  onChange({
                    singleRetrievalConfig: {
                      model: {
                        provider: singleRetrievalConfig?.model.provider ?? '',
                        name: singleRetrievalConfig?.model.name ?? '',
                        mode: singleRetrievalConfig?.model.mode ?? 'chat',
                        completion_params: completionParams,
                      },
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
                <li key={dataset.id}>{dataset.name}</li>
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

      <div className="py-2">
        {/* Keep saved conditions until an explicit edit; catalog loading must not prune them. */}
        <MetadataFilter
          metadataList={metadataList}
          metadataFilterMode={metadataFilterMode}
          metadataFilteringConditions={metadataFilteringConditions}
          handleMetadataFilterModeChange={(nextMode) => onChange({ metadataFilterMode: nextMode })}
          handleAddCondition={(metadataItem) => {
            onChange({
              metadataFilteringConditions: {
                ...metadataFilteringConditions,
                conditions: [
                  ...metadataFilteringConditions.conditions,
                  createMetadataCondition(metadataItem),
                ],
              },
            })
          }}
          handleRemoveCondition={(conditionId) => {
            onChange({
              metadataFilteringConditions: {
                ...metadataFilteringConditions,
                conditions: metadataFilteringConditions.conditions.filter(
                  (condition) => condition.id !== conditionId,
                ),
              },
            })
          }}
          handleToggleConditionLogicalOperator={() => {
            onChange({
              metadataFilteringConditions: {
                ...metadataFilteringConditions,
                logical_operator:
                  metadataFilteringConditions.logical_operator === LogicalOperator.and
                    ? LogicalOperator.or
                    : LogicalOperator.and,
              },
            })
          }}
          handleUpdateCondition={(conditionId, nextCondition) => {
            onChange({
              metadataFilteringConditions: {
                ...metadataFilteringConditions,
                conditions: metadataFilteringConditions.conditions.map((condition) =>
                  condition.id === conditionId ? nextCondition : condition,
                ),
              },
            })
          }}
          metadataModelConfig={metadataModelConfig}
          handleMetadataModelChange={(model) => {
            onChange({
              metadataModelConfig: {
                provider: model.provider,
                name: model.modelId,
                mode: model.mode ?? metadataModelConfig?.mode ?? 'chat',
                completion_params: metadataModelConfig?.completion_params ?? { temperature: 0.7 },
              },
            })
          }}
          handleMetadataCompletionParamsChange={(completionParams) => {
            onChange({
              metadataModelConfig: {
                provider: metadataModelConfig?.provider ?? '',
                name: metadataModelConfig?.name ?? '',
                mode: metadataModelConfig?.mode ?? 'chat',
                completion_params: completionParams,
              },
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
export function ClassicKnowledgeSettings(props: Props) {
  const { t } = useTranslation(['common'])
  const ids = props.item.datasetRefs?.flatMap((dataset) => (dataset.id ? [dataset.id] : [])) ?? []
  const queries = useQueries({
    queries: (props.item.selectedDatasets === undefined ? ids : []).map((id) =>
      consoleQuery.datasets.byDatasetId.get.queryOptions({ input: { params: { dataset_id: id } } }),
    ),
  })
  const datasets =
    props.item.selectedDatasets ?? queries.flatMap((query) => (query.data ? [query.data] : []))
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
        <AddKnowledge
          selectedIds={ids}
          modal
          onChange={(next) =>
            props.onChange({
              datasetRefs: next.map(({ id, name }) => ({ id, name })),
              selectedDatasets: undefined,
            })
          }
        />
      </div>
    )
  return <ClassicSettingsFields {...props} selectedDatasets={datasets} />
}
