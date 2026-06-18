'use client'

import type { AgentKnowledgeDatasetConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import type {
  MetadataFilteringCondition,
  MetadataFilteringModeEnum,
  MultipleRetrievalConfig,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { ModelConfig } from '@/app/components/workflow/types'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import type { DataSet, MetadataInDoc } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { RadioRoot } from '@langgenius/dify-ui/radio'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { intersectionBy } from 'es-toolkit/compat'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IndexingType } from '@/app/components/datasets/create/step-two/hooks/use-indexing-config'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddKnowledge from '@/app/components/workflow/nodes/knowledge-retrieval/components/add-dataset'
import DatasetList from '@/app/components/workflow/nodes/knowledge-retrieval/components/dataset-list'
import MetadataFilter from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter'
import RetrievalConfig from '@/app/components/workflow/nodes/knowledge-retrieval/components/retrieval-config'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringVariableType,
  MetadataFilteringModeEnum as WorkflowMetadataFilteringModeEnum,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { DATASET_DEFAULT } from '@/config'
import { useDocLink } from '@/context/i18n'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { AppModeEnum, RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'

type KnowledgeRetrievalQueryMode = 'agent' | 'custom'

const queryModeOptions: KnowledgeRetrievalQueryMode[] = ['agent', 'custom']

const optionCardClassName = cn(
  'flex h-8 flex-1 items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg px-3 py-2 text-center system-sm-regular text-text-secondary transition-colors',
  'hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
  'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
  'data-checked:border-[1.5px] data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:font-medium data-checked:text-text-primary data-checked:shadow-xs data-checked:shadow-shadow-shadow-3',
)

function KnowledgeRetrievalDialogIcon() {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-divider-subtle bg-util-colors-green-green-500 p-1 text-text-primary-on-surface shadow-md shadow-shadow-shadow-5">
      <span aria-hidden className="i-ri-book-open-line size-4" />
    </span>
  )
}

function DialogFormLabel({
  children,
  id,
}: {
  children: ReactNode
  id?: string
}) {
  return (
    <div id={id} className="flex min-h-6 items-center system-sm-semibold-uppercase text-text-secondary">
      {children}
    </div>
  )
}

const createDefaultRetrievalConfig = (): MultipleRetrievalConfig => ({
  top_k: DATASET_DEFAULT.top_k,
  score_threshold: null,
  reranking_enable: false,
})

const createDatasetFromRef = (dataset: AgentKnowledgeDatasetConfig, index: number): DataSet => {
  const id = dataset.id ?? dataset.name ?? `dataset-${index}`
  const name = dataset.name ?? id

  return {
    id,
    name,
    indexing_status: 'completed',
    icon_info: {
      icon: '📙',
      icon_type: 'emoji',
      icon_background: '#FFF4ED',
      icon_url: '',
    },
    description: dataset.description ?? '',
    permission: DatasetPermission.allTeamMembers,
    data_source_type: DataSourceType.FILE,
    indexing_technique: IndexingType.QUALIFIED,
    created_by: '',
    updated_by: '',
    updated_at: 0,
    app_count: 0,
    doc_form: ChunkingMode.text,
    document_count: 0,
    total_document_count: 0,
    word_count: 0,
    provider: '',
    embedding_model: '',
    embedding_model_provider: '',
    embedding_available: false,
    retrieval_model_dict: {
      search_method: RETRIEVE_METHOD.semantic,
      reranking_enable: false,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
      top_k: DATASET_DEFAULT.top_k,
      score_threshold_enabled: false,
      score_threshold: 0,
    },
    retrieval_model: {
      search_method: RETRIEVE_METHOD.semantic,
      reranking_enable: false,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
      top_k: DATASET_DEFAULT.top_k,
      score_threshold_enabled: false,
      score_threshold: 0,
    },
    tags: [],
    external_knowledge_info: {
      external_knowledge_id: '',
      external_knowledge_api_id: '',
      external_knowledge_api_name: '',
      external_knowledge_api_endpoint: '',
    },
    external_retrieval_model: {
      top_k: DATASET_DEFAULT.top_k,
      score_threshold: 0,
      score_threshold_enabled: false,
    },
    built_in_field_enabled: false,
    runtime_mode: 'general',
    enable_api: false,
    is_multimodal: false,
  }
}

const getSelectedDatasets = (item?: AgentKnowledgeRetrievalItem) => (
  item?.selectedDatasets ?? item?.datasetRefs?.map(createDatasetFromRef) ?? []
)

const createMetadataCondition = ({ id, name, type }: MetadataInDoc): MetadataFilteringCondition => ({
  id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
  metadata_id: id,
  name,
  comparison_operator: type === MetadataFilteringVariableType.number
    ? ComparisonOperator.equal
    : ComparisonOperator.is,
})

export function AgentKnowledgeRetrievalDialog({
  item,
  initialName,
  onItemChange,
  open,
  onOpenChange,
}: {
  item?: AgentKnowledgeRetrievalItem
  initialName?: string
  onItemChange?: (item: AgentKnowledgeRetrievalItem) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('agentV2')
  const docLink = useDocLink()
  const [name, setName] = useState(() => item?.name ?? initialName ?? t('agentDetail.configure.knowledgeRetrieval.retrievalOne'))
  const [isEditingName, setIsEditingName] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [queryMode, setQueryMode] = useState<KnowledgeRetrievalQueryMode>(item?.queryMode ?? 'agent')
  const [customQuery, setCustomQuery] = useState(item?.customQuery ?? '')
  const [selectedDatasets, setSelectedDatasets] = useState<DataSet[]>(() => getSelectedDatasets(item))
  const [retrievalMode, setRetrievalMode] = useState(item?.retrievalMode ?? RETRIEVE_TYPE.multiWay)
  const [multipleRetrievalConfig, setMultipleRetrievalConfig] = useState(item?.multipleRetrievalConfig ?? createDefaultRetrievalConfig)
  const [rerankModelOpen, setRerankModelOpen] = useState(false)
  const [metadataFilterMode, setMetadataFilterMode] = useState<MetadataFilteringModeEnum>(item?.metadataFilterMode ?? WorkflowMetadataFilteringModeEnum.disabled)
  const [metadataFilteringConditions, setMetadataFilteringConditions] = useState(item?.metadataFilteringConditions ?? {
    logical_operator: LogicalOperator.and,
    conditions: [] as MetadataFilteringCondition[],
  })
  const [metadataModelConfig, setMetadataModelConfig] = useState<ModelConfig | undefined>(item?.metadataModelConfig)
  const queryModeLabelId = 'agent-knowledge-retrieval-query-mode-label'
  const updateItem = (patch: Partial<AgentKnowledgeRetrievalItem>) => {
    if (!item)
      return

    onItemChange?.({
      ...item,
      name,
      queryMode,
      customQuery,
      selectedDatasets,
      retrievalMode,
      multipleRetrievalConfig,
      metadataFilterMode,
      metadataFilteringConditions,
      metadataModelConfig,
      ...patch,
    })
  }
  const metadataList = useMemo(() => {
    const datasetsWithMetadata = selectedDatasets.filter(dataset => !!dataset.doc_metadata)

    if (datasetsWithMetadata.length === 0)
      return []

    return intersectionBy(...datasetsWithMetadata.map(dataset => dataset.doc_metadata!), 'name')
  }, [selectedDatasets])

  useEffect(() => {
    if (!isEditingName)
      return

    nameInputRef.current?.focus()
    nameInputRef.current?.select()
  }, [isEditingName])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[520px] max-h-[calc(100dvh-2rem)] w-[400px] flex-col overflow-hidden p-0">
        <DialogTitle className="sr-only">
          {t('agentDetail.configure.knowledgeRetrieval.dialog.title')}
        </DialogTitle>
        <div className="flex items-center gap-2 px-4 pt-3">
          <KnowledgeRetrievalDialogIcon />
          {isEditingName
            ? (
                <Input
                  ref={nameInputRef}
                  aria-label={t('agentDetail.configure.knowledgeRetrieval.dialog.nameLabel')}
                  className="h-7 min-w-0 flex-1 rounded-md px-1 py-0 system-xl-semibold text-text-primary"
                  value={name}
                  onBlur={() => setIsEditingName(false)}
                  onChange={(event) => {
                    const nextName = event.currentTarget.value
                    setName(nextName)
                    updateItem({ name: nextName })
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter')
                      setIsEditingName(false)
                  }}
                />
              )
            : (
                <button
                  type="button"
                  className="flex h-7 min-w-0 flex-1 items-center rounded-md px-1 py-0 text-left system-xl-semibold text-text-primary hover:bg-components-input-bg-hover focus-visible:border focus-visible:border-components-input-border-active focus-visible:bg-components-input-bg-active focus-visible:shadow-xs focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                  onClick={() => setIsEditingName(true)}
                >
                  <span className="min-w-0 truncate">
                    {name}
                  </span>
                </button>
              )}
          <DialogCloseButton className="static size-7 shrink-0 rounded-md" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1 py-2">
          <div className="flex flex-col gap-1 px-4 py-2">
            <DialogFormLabel id={queryModeLabelId}>
              {t('agentDetail.configure.knowledgeRetrieval.dialog.query.label')}
            </DialogFormLabel>
            <RadioGroup<KnowledgeRetrievalQueryMode>
              aria-labelledby={queryModeLabelId}
              className="w-full gap-2"
              value={queryMode}
              onValueChange={(nextMode) => {
                if (nextMode) {
                  setQueryMode(nextMode)
                  updateItem({ queryMode: nextMode })
                }
              }}
            >
              {queryModeOptions.map(mode => (
                <RadioRoot
                  key={mode}
                  value={mode}
                  variant="unstyled"
                  nativeButton
                  render={<button type="button" className={optionCardClassName} />}
                >
                  <span className="min-w-0 truncate">
                    {t(`agentDetail.configure.knowledgeRetrieval.dialog.query.${mode}`)}
                  </span>
                </RadioRoot>
              ))}
            </RadioGroup>
            {queryMode === 'custom'
              ? (
                  <>
                    <div className="pt-1">
                      <Textarea
                        aria-label={t('agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel')}
                        className="h-20 resize-none rounded-lg px-3 py-2 system-sm-regular"
                        placeholder={t('agentDetail.configure.knowledgeRetrieval.dialog.query.customPlaceholder')}
                        value={customQuery}
                        onValueChange={(nextQuery) => {
                          setCustomQuery(nextQuery)
                          updateItem({ customQuery: nextQuery })
                        }}
                      />
                    </div>
                    <p className="system-xs-regular text-text-tertiary">
                      {t('agentDetail.configure.knowledgeRetrieval.dialog.query.customDescription')}
                    </p>
                  </>
                )
              : (
                  <p className="pt-1 system-xs-regular text-text-tertiary">
                    {t('agentDetail.configure.knowledgeRetrieval.dialog.query.agentDescription')}
                  </p>
                )}
          </div>

          <div className="px-4 py-2">
            <Field
              title={t('agentDetail.configure.knowledgeRetrieval.dialog.knowledge.label')}
              required
              operations={(
                <div className="flex items-center space-x-1">
                  <RetrievalConfig
                    payload={{
                      retrieval_mode: retrievalMode,
                      multiple_retrieval_config: multipleRetrievalConfig,
                    }}
                    onRetrievalModeChange={(nextRetrievalMode) => {
                      setRetrievalMode(nextRetrievalMode)
                      updateItem({ retrievalMode: nextRetrievalMode })
                    }}
                    onMultipleRetrievalConfigChange={(nextMultipleRetrievalConfig) => {
                      setMultipleRetrievalConfig(nextMultipleRetrievalConfig)
                      updateItem({ multipleRetrievalConfig: nextMultipleRetrievalConfig })
                    }}
                    readonly={!selectedDatasets.length}
                    modal
                    rerankModalOpen={rerankModelOpen}
                    onRerankModelOpenChange={setRerankModelOpen}
                    selectedDatasets={selectedDatasets}
                  />
                  <div className="h-3 w-px bg-divider-regular" />
                  <AddKnowledge
                    selectedIds={selectedDatasets.map(dataset => dataset.id)}
                    modal
                    onChange={(nextDatasets) => {
                      setSelectedDatasets(nextDatasets)
                      updateItem({ selectedDatasets: nextDatasets })
                    }}
                  />
                </div>
              )}
            >
              <DatasetList
                list={selectedDatasets}
                onChange={setSelectedDatasets}
                settingsDrawerBackdropClassName="bg-background-overlay"
                settingsDrawerBackdropForceRender
                settingsDrawerPopupClassName="data-[swipe-direction=right]:top-6 data-[swipe-direction=right]:bottom-6"
                settingsModalHeight="100%"
              />
            </Field>
          </div>

          <div className="py-2">
            <MetadataFilter
              metadataList={metadataList}
              selectedDatasetsLoaded
              metadataFilterMode={metadataFilterMode}
              metadataFilteringConditions={metadataFilteringConditions}
              handleMetadataFilterModeChange={(nextMode) => {
                setMetadataFilterMode(nextMode)
                updateItem({ metadataFilterMode: nextMode })
              }}
              handleAddCondition={(metadataItem) => {
                setMetadataFilteringConditions((current) => {
                  const nextConditions = {
                    ...current,
                    conditions: [...current.conditions, createMetadataCondition(metadataItem)],
                  }
                  updateItem({ metadataFilteringConditions: nextConditions })
                  return nextConditions
                })
              }}
              handleRemoveCondition={(conditionId) => {
                setMetadataFilteringConditions((current) => {
                  const nextConditions = {
                    ...current,
                    conditions: current.conditions.filter(condition => condition.id !== conditionId),
                  }
                  updateItem({ metadataFilteringConditions: nextConditions })
                  return nextConditions
                })
              }}
              handleToggleConditionLogicalOperator={() => {
                setMetadataFilteringConditions((current) => {
                  const nextConditions = {
                    ...current,
                    logical_operator: current.logical_operator === LogicalOperator.and
                      ? LogicalOperator.or
                      : LogicalOperator.and,
                  }
                  updateItem({ metadataFilteringConditions: nextConditions })
                  return nextConditions
                })
              }}
              handleUpdateCondition={(conditionId, nextCondition) => {
                setMetadataFilteringConditions((current) => {
                  const nextConditions = {
                    ...current,
                    conditions: current.conditions.map(condition => condition.id === conditionId ? nextCondition : condition),
                  }
                  updateItem({ metadataFilteringConditions: nextConditions })
                  return nextConditions
                })
              }}
              metadataModelConfig={metadataModelConfig}
              handleMetadataModelChange={(model) => {
                setMetadataModelConfig((current) => {
                  const nextMetadataModelConfig = {
                    provider: model.provider,
                    name: model.modelId,
                    mode: model.mode ?? current?.mode ?? AppModeEnum.CHAT,
                    completion_params: current?.completion_params ?? { temperature: 0.7 },
                  }
                  updateItem({ metadataModelConfig: nextMetadataModelConfig })
                  return nextMetadataModelConfig
                })
              }}
              handleMetadataCompletionParamsChange={(completionParams) => {
                setMetadataModelConfig((current) => {
                  const nextMetadataModelConfig = {
                    provider: current?.provider ?? '',
                    name: current?.name ?? '',
                    mode: current?.mode ?? AppModeEnum.CHAT,
                    completion_params: completionParams,
                  }
                  updateItem({ metadataModelConfig: nextMetadataModelConfig })
                  return nextMetadataModelConfig
                })
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 px-4 pb-4">
          <div aria-hidden className="h-2 w-8 border-b border-divider-regular" />
          <a
            href={docLink('/use-dify/knowledge/create-knowledge/setting-indexing-methods')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1 system-xs-regular text-text-tertiary hover:text-text-secondary hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-book-read-line size-3 shrink-0" />
            <span className="min-w-0 truncate">
              {t('form.retrievalSetting.learnMore', { ns: 'datasetSettings' })}
            </span>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
