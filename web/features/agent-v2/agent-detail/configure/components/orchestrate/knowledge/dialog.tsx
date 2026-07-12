'use client'

import type { AgentKnowledgeDatasetConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactNode } from 'react'
import type {
  MetadataFilteringCondition,
  MetadataFilteringModeEnum,
  MultipleRetrievalConfig,
  SingleRetrievalConfig,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { ModelConfig } from '@/app/components/workflow/types'
import type { AgentKnowledgeRetrievalItem } from '@/features/agent-v2/agent-composer/form-state'
import type { DataSet, MetadataInDoc } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { intersectionBy } from 'es-toolkit/compat'
import { useAtomValue } from 'jotai'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IndexingType } from '@/app/components/datasets/create/step-two/hooks/use-indexing-config'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useCurrentProviderAndModel, useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
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
import { getMultipleRetrievalConfig } from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import { DATASET_DEFAULT } from '@/config'
import { useDocLink } from '@/context/i18n'
import { useKnowledgeValidationMessage, validateKnowledgeRetrievals } from '@/features/agent-v2/agent-composer/knowledge-validation'
import { agentComposerKnowledgeRetrievalsAtom } from '@/features/agent-v2/agent-composer/store-modules/knowledge'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { AppModeEnum, RETRIEVE_METHOD, RETRIEVE_TYPE } from '@/types/app'

type KnowledgeRetrievalQueryMode = 'agent' | 'custom'
type MetadataFilteringConditions = {
  logical_operator: LogicalOperator
  conditions: MetadataFilteringCondition[]
}

type KnowledgeRetrievalDialogState = {
  customQuery: string
  metadataFilterMode: MetadataFilteringModeEnum
  metadataFilteringConditions: MetadataFilteringConditions
  metadataModelConfig?: ModelConfig
  multipleRetrievalConfig: MultipleRetrievalConfig
  name: string
  queryMode: KnowledgeRetrievalQueryMode
  retrievalMode: typeof RETRIEVE_TYPE[keyof typeof RETRIEVE_TYPE]
  selectedDatasets: DataSet[]
  singleRetrievalConfig?: SingleRetrievalConfig
}

type AgentKnowledgeRetrievalDialogProps = {
  item?: AgentKnowledgeRetrievalItem
  initialName?: string
  onItemCreate?: (item: AgentKnowledgeRetrievalItem) => void
  onItemChange?: (item: AgentKnowledgeRetrievalItem) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

const queryModeOptions: KnowledgeRetrievalQueryMode[] = ['agent', 'custom']

const optionCardClassName = cn(
  'flex h-8 flex-1 items-center justify-center rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg px-3 py-2 text-center system-sm-regular text-text-secondary transition-colors',
  'hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover',
  'focus-visible:ring-1 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
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

const createDefaultMetadataFilteringConditions = (): MetadataFilteringConditions => ({
  logical_operator: LogicalOperator.and,
  conditions: [],
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

const getDialogName = (
  item: AgentKnowledgeRetrievalItem | undefined,
  initialName: string | undefined,
  fallbackName: string,
) => item?.name ?? initialName ?? fallbackName

const createDialogState = (
  item: AgentKnowledgeRetrievalItem | undefined,
  initialName: string | undefined,
  fallbackName: string,
): KnowledgeRetrievalDialogState => ({
  customQuery: item?.customQuery ?? '',
  metadataFilterMode: item?.metadataFilterMode ?? WorkflowMetadataFilteringModeEnum.disabled,
  metadataFilteringConditions: item?.metadataFilteringConditions ?? createDefaultMetadataFilteringConditions(),
  metadataModelConfig: item?.metadataModelConfig,
  multipleRetrievalConfig: item?.multipleRetrievalConfig ?? createDefaultRetrievalConfig(),
  name: getDialogName(item, initialName, fallbackName),
  queryMode: item?.queryMode ?? 'agent',
  retrievalMode: item?.retrievalMode ?? RETRIEVE_TYPE.multiWay,
  selectedDatasets: getSelectedDatasets(item),
  singleRetrievalConfig: item?.singleRetrievalConfig,
})

const createMetadataCondition = ({ id, name, type }: MetadataInDoc): MetadataFilteringCondition => ({
  id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
  metadata_id: id,
  name,
  comparison_operator: type === MetadataFilteringVariableType.number
    ? ComparisonOperator.equal
    : ComparisonOperator.is,
})

function EditableKnowledgeRetrievalName({
  editLabel,
  inputLabel,
  invalid,
  name,
  onCommit,
}: {
  editLabel: string
  inputLabel: string
  invalid: boolean
  name: string
  onCommit: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreButtonFocusRef = useRef(false)

  useLayoutEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
      return
    }

    if (!restoreButtonFocusRef.current)
      return

    restoreButtonFocusRef.current = false
    const button = buttonRef.current
    if (!button)
      return

    const activeElement = button.ownerDocument.activeElement
    if (!activeElement || activeElement === button.ownerDocument.body)
      button.focus({ preventScroll: true })
  }, [editing])

  const finishEditing = (commit: boolean) => {
    if (commit)
      onCommit(draftName)
    else
      setDraftName(name)

    restoreButtonFocusRef.current = true
    setEditing(false)
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        aria-label={inputLabel}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        className="h-7 min-w-0 flex-1 rounded-md px-1 py-0 system-xl-semibold text-text-primary"
        name="knowledgeRetrievalName"
        value={draftName}
        onBlur={() => {
          onCommit(draftName)
          setEditing(false)
        }}
        onChange={event => setDraftName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing)
            return

          if (event.key === 'Enter') {
            event.preventDefault()
            finishEditing(true)
            return
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finishEditing(false)
          }
        }}
      />
    )
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={editLabel}
      className="flex h-7 min-w-0 flex-1 items-center rounded-md border border-transparent px-1 py-0 text-left system-xl-semibold text-text-primary hover:bg-components-input-bg-hover focus-visible:border-components-input-border-active focus-visible:bg-components-input-bg-active focus-visible:shadow-xs focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      onClick={() => {
        setDraftName(name)
        setEditing(true)
      }}
    >
      <span className="min-w-0 truncate">
        {name}
      </span>
    </button>
  )
}

function AgentKnowledgeRetrievalDialogContent({
  item,
  initialName,
  onItemCreate,
  onItemChange,
}: Omit<AgentKnowledgeRetrievalDialogProps, 'open' | 'onOpenChange'>) {
  const { t } = useTranslation('agentV2')
  const docLink = useDocLink()
  const retrievals = useAtomValue(agentComposerKnowledgeRetrievalsAtom)
  const getValidationMessage = useKnowledgeValidationMessage()
  const fallbackName = t($ => $['agentDetail.configure.knowledgeRetrieval.retrievalOne'])
  const [dialogState, setDialogState] = useState(() => createDialogState(item, initialName, fallbackName))
  const [rerankModelOpen, setRerankModelOpen] = useState(false)
  const queryModeLabelId = 'agent-knowledge-retrieval-query-mode-label'
  const {
    customQuery,
    metadataFilterMode,
    metadataFilteringConditions,
    metadataModelConfig,
    multipleRetrievalConfig,
    name,
    queryMode,
    retrievalMode,
    selectedDatasets,
    singleRetrievalConfig,
  } = dialogState
  const {
    modelList: rerankModelList,
    defaultModel: rerankDefaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)
  const {
    currentModel: currentRerankModel,
    currentProvider: currentRerankProvider,
  } = useCurrentProviderAndModel(
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
  ) => getMultipleRetrievalConfig(
    config,
    nextSelectedDatasets,
    originalDatasets,
    fallbackRerankModel,
  )
  const effectiveMultipleRetrievalConfig = retrievalMode === RETRIEVE_TYPE.multiWay && selectedDatasets.length > 0
    ? resolveMultipleRetrievalConfig(multipleRetrievalConfig)
    : multipleRetrievalConfig
  const createItemFromDialogState = (
    state: KnowledgeRetrievalDialogState,
    id = globalThis.crypto?.randomUUID?.() ?? `retrieval-${Date.now()}`,
  ): AgentKnowledgeRetrievalItem => ({
    id,
    name: state.name,
    queryMode: state.queryMode,
    customQuery: state.customQuery,
    selectedDatasets: state.selectedDatasets,
    retrievalMode: state.retrievalMode,
    multipleRetrievalConfig: state.multipleRetrievalConfig,
    singleRetrievalConfig: state.singleRetrievalConfig,
    metadataFilterMode: state.metadataFilterMode,
    metadataFilteringConditions: state.metadataFilteringConditions,
    metadataModelConfig: state.metadataModelConfig,
  })
  const applyDialogStatePatch = (patch: Partial<KnowledgeRetrievalDialogState>) => {
    const nextState = {
      ...dialogState,
      ...patch,
    }
    setDialogState(nextState)

    if (item) {
      onItemChange?.({
        ...item,
        ...createItemFromDialogState(nextState, item.id),
      })
    }

    return nextState
  }
  const handleSelectedDatasetsChange = (nextDatasets: DataSet[]) => {
    const nextMultipleRetrievalConfig = retrievalMode === RETRIEVE_TYPE.multiWay && nextDatasets.length > 0
      ? resolveMultipleRetrievalConfig(multipleRetrievalConfig, nextDatasets)
      : multipleRetrievalConfig
    const nextState = applyDialogStatePatch({
      multipleRetrievalConfig: nextMultipleRetrievalConfig,
      selectedDatasets: nextDatasets,
    })

    if (item)
      return

    if (nextDatasets.length > 0)
      onItemCreate?.(createItemFromDialogState(nextState))
  }
  const metadataList = useMemo(() => {
    const datasetsWithMetadata = selectedDatasets.filter(dataset => !!dataset.doc_metadata)

    if (datasetsWithMetadata.length === 0)
      return []

    return intersectionBy(...datasetsWithMetadata.map(dataset => dataset.doc_metadata!), 'name')
  }, [selectedDatasets])
  const validation = useMemo(() => validateKnowledgeRetrievals(retrievals), [retrievals])
  const itemValidation = item ? validation.byId[item.id] : undefined
  const nameError = getValidationMessage(itemValidation?.name)
  const datasetsError = getValidationMessage(itemValidation?.datasets)
  const queryError = getValidationMessage(itemValidation?.query)
  const retrievalError = getValidationMessage(itemValidation?.retrieval)
  const metadataError = itemValidation?.metadata === 'metadata_model_required'
    ? undefined
    : getValidationMessage(itemValidation?.metadata)

  return (
    <>
      <DialogTitle className="sr-only">
        {t($ => $['agentDetail.configure.knowledgeRetrieval.dialog.title'])}
      </DialogTitle>
      <div className="flex items-center gap-2 px-4 pt-3">
        <KnowledgeRetrievalDialogIcon />
        <EditableKnowledgeRetrievalName
          editLabel={t($ => $['agentDetail.configure.knowledgeRetrieval.edit'], { name })}
          inputLabel={t($ => $['agentDetail.configure.knowledgeRetrieval.dialog.nameLabel'])}
          invalid={!!nameError}
          name={name}
          onCommit={nextName => applyDialogStatePatch({ name: nextName })}
        />
        <DialogCloseButton className="static size-7 shrink-0 rounded-md" />
      </div>
      {nameError && (
        <div role="alert" className="px-4 pt-1 system-xs-regular text-text-destructive">
          {nameError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-1 py-2">
        <div className="flex flex-col gap-1 px-4 py-2">
          <DialogFormLabel id={queryModeLabelId}>
            {t($ => $['agentDetail.configure.knowledgeRetrieval.dialog.query.label'])}
          </DialogFormLabel>
          <RadioGroup<KnowledgeRetrievalQueryMode>
            aria-labelledby={queryModeLabelId}
            className="w-full gap-2"
            value={queryMode}
            onValueChange={(nextMode) => {
              if (nextMode)
                applyDialogStatePatch({ queryMode: nextMode })
            }}
          >
            {queryModeOptions.map(mode => (
              <RadioItem<KnowledgeRetrievalQueryMode>
                key={mode}
                value={mode}
                nativeButton
                render={<button type="button" className={optionCardClassName} />}
              >
                <span className="min-w-0 truncate">
                  {t($ => $[`agentDetail.configure.knowledgeRetrieval.dialog.query.${mode}`])}
                </span>
              </RadioItem>
            ))}
          </RadioGroup>
          {queryMode === 'custom'
            ? (
                <>
                  <div className="pt-1">
                    <Textarea
                      aria-label={t($ => $['agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel'])}
                      aria-invalid={queryError ? true : undefined}
                      className="h-20 resize-none rounded-lg px-3 py-2 system-sm-regular"
                      placeholder={t($ => $['agentDetail.configure.knowledgeRetrieval.dialog.query.customPlaceholder'])}
                      value={customQuery}
                      onValueChange={nextQuery => applyDialogStatePatch({ customQuery: nextQuery })}
                    />
                  </div>
                  <p className="system-xs-regular text-text-tertiary">
                    {t($ => $['agentDetail.configure.knowledgeRetrieval.dialog.query.customDescription'])}
                  </p>
                  {queryError && (
                    <p role="alert" className="system-xs-regular text-text-destructive">
                      {queryError}
                    </p>
                  )}
                </>
              )
            : (
                <p className="pt-1 system-xs-regular text-text-tertiary">
                  {t($ => $['agentDetail.configure.knowledgeRetrieval.dialog.query.agentDescription'])}
                </p>
              )}
        </div>

        <div className="px-4 py-2">
          <Field
            title={t($ => $['agentDetail.configure.knowledgeRetrieval.dialog.knowledge.label'])}
            required
            operations={(
              <div className="flex items-center space-x-1">
                <RetrievalConfig
                  payload={{
                    retrieval_mode: retrievalMode,
                    multiple_retrieval_config: effectiveMultipleRetrievalConfig,
                    single_retrieval_config: singleRetrievalConfig,
                  }}
                  onRetrievalModeChange={(nextRetrievalMode) => {
                    const nextMultipleRetrievalConfig = nextRetrievalMode === RETRIEVE_TYPE.multiWay
                      ? resolveMultipleRetrievalConfig(multipleRetrievalConfig)
                      : multipleRetrievalConfig

                    applyDialogStatePatch({
                      multipleRetrievalConfig: nextMultipleRetrievalConfig,
                      retrievalMode: nextRetrievalMode,
                    })
                  }}
                  onMultipleRetrievalConfigChange={(nextMultipleRetrievalConfig) => {
                    const normalizedMultipleRetrievalConfig = resolveMultipleRetrievalConfig(nextMultipleRetrievalConfig)

                    applyDialogStatePatch({ multipleRetrievalConfig: normalizedMultipleRetrievalConfig })
                  }}
                  singleRetrievalModelConfig={singleRetrievalConfig?.model}
                  onSingleRetrievalModelChange={(model) => {
                    applyDialogStatePatch({
                      singleRetrievalConfig: {
                        model: {
                          provider: model.provider,
                          name: model.modelId,
                          mode: model.mode ?? singleRetrievalConfig?.model.mode ?? AppModeEnum.CHAT,
                          completion_params: singleRetrievalConfig?.model.completion_params ?? { temperature: 0.7 },
                        },
                      },
                    })
                  }}
                  onSingleRetrievalModelParamsChange={(completionParams) => {
                    applyDialogStatePatch({
                      singleRetrievalConfig: {
                        model: {
                          provider: singleRetrievalConfig?.model.provider ?? '',
                          name: singleRetrievalConfig?.model.name ?? '',
                          mode: singleRetrievalConfig?.model.mode ?? AppModeEnum.CHAT,
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
                  selectedIds={selectedDatasets.map(dataset => dataset.id)}
                  modal
                  onChange={handleSelectedDatasetsChange}
                />
              </div>
            )}
          >
            <>
              {selectedDatasets.length > 0 && (
                <DatasetList
                  list={selectedDatasets}
                  onChange={handleSelectedDatasetsChange}
                  settingsDrawerBackdropClassName="bg-background-overlay"
                  settingsDrawerBackdropForceRender
                  settingsDrawerPopupClassName="data-[swipe-direction=right]:top-6 data-[swipe-direction=right]:bottom-6"
                  settingsModalHeight="100%"
                />
              )}
              {(datasetsError || retrievalError) && (
                <div role="alert" className="pt-2 system-xs-regular text-text-destructive">
                  {datasetsError ?? retrievalError}
                </div>
              )}
            </>
          </Field>
        </div>

        <div className="py-2">
          <MetadataFilter
            metadataList={metadataList}
            selectedDatasetsLoaded
            metadataFilterMode={metadataFilterMode}
            metadataFilteringConditions={metadataFilteringConditions}
            handleMetadataFilterModeChange={nextMode => applyDialogStatePatch({ metadataFilterMode: nextMode })}
            handleAddCondition={(metadataItem) => {
              applyDialogStatePatch({
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
              applyDialogStatePatch({
                metadataFilteringConditions: {
                  ...metadataFilteringConditions,
                  conditions: metadataFilteringConditions.conditions.filter(condition => condition.id !== conditionId),
                },
              })
            }}
            handleToggleConditionLogicalOperator={() => {
              applyDialogStatePatch({
                metadataFilteringConditions: {
                  ...metadataFilteringConditions,
                  logical_operator: metadataFilteringConditions.logical_operator === LogicalOperator.and
                    ? LogicalOperator.or
                    : LogicalOperator.and,
                },
              })
            }}
            handleUpdateCondition={(conditionId, nextCondition) => {
              applyDialogStatePatch({
                metadataFilteringConditions: {
                  ...metadataFilteringConditions,
                  conditions: metadataFilteringConditions.conditions.map(condition => condition.id === conditionId ? nextCondition : condition),
                },
              })
            }}
            metadataModelConfig={metadataModelConfig}
            handleMetadataModelChange={(model) => {
              applyDialogStatePatch({
                metadataModelConfig: {
                  provider: model.provider,
                  name: model.modelId,
                  mode: model.mode ?? metadataModelConfig?.mode ?? AppModeEnum.CHAT,
                  completion_params: metadataModelConfig?.completion_params ?? { temperature: 0.7 },
                },
              })
            }}
            handleMetadataCompletionParamsChange={(completionParams) => {
              applyDialogStatePatch({
                metadataModelConfig: {
                  provider: metadataModelConfig?.provider ?? '',
                  name: metadataModelConfig?.name ?? '',
                  mode: metadataModelConfig?.mode ?? AppModeEnum.CHAT,
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
            {t($ => $['form.retrievalSetting.learnMore'], { ns: 'datasetSettings' })}
          </span>
        </a>
      </div>
    </>
  )
}

export function AgentKnowledgeRetrievalDialog({
  item,
  initialName,
  onItemCreate,
  onItemChange,
  open,
  onOpenChange,
}: AgentKnowledgeRetrievalDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="flex h-130 max-h-[calc(100dvh-2rem)] w-[400px] flex-col overflow-hidden p-0"
      >
        <AgentKnowledgeRetrievalDialogContent
          item={item}
          initialName={initialName}
          onItemCreate={onItemCreate}
          onItemChange={onItemChange}
        />
      </DialogContent>
    </Dialog>
  )
}
