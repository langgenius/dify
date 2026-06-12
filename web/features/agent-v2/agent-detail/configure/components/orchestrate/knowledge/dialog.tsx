'use client'

import type { ReactNode } from 'react'
import type {
  MetadataFilteringCondition,
  MetadataFilteringModeEnum,
  MultipleRetrievalConfig,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { ModelConfig } from '@/app/components/workflow/types'
import type { DataSet, MetadataInDoc } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { RadioRoot } from '@langgenius/dify-ui/radio'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { intersectionBy } from 'es-toolkit/compat'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { AppModeEnum, RETRIEVE_TYPE } from '@/types/app'

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

const createMetadataCondition = ({ id, name, type }: MetadataInDoc): MetadataFilteringCondition => ({
  id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
  metadata_id: id,
  name,
  comparison_operator: type === MetadataFilteringVariableType.number
    ? ComparisonOperator.equal
    : ComparisonOperator.is,
})

export function AgentKnowledgeRetrievalDialog({
  initialName,
  open,
  onOpenChange,
}: {
  initialName?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('agentV2')
  const [name, setName] = useState(() => initialName ?? t('agentDetail.configure.knowledgeRetrieval.retrievalOne'))
  const [queryMode, setQueryMode] = useState<KnowledgeRetrievalQueryMode>('agent')
  const [selectedDatasets, setSelectedDatasets] = useState<DataSet[]>([])
  const [retrievalMode, setRetrievalMode] = useState(RETRIEVE_TYPE.multiWay)
  const [multipleRetrievalConfig, setMultipleRetrievalConfig] = useState(createDefaultRetrievalConfig)
  const [rerankModelOpen, setRerankModelOpen] = useState(false)
  const [metadataFilterMode, setMetadataFilterMode] = useState<MetadataFilteringModeEnum>(WorkflowMetadataFilteringModeEnum.disabled)
  const [metadataFilteringConditions, setMetadataFilteringConditions] = useState({
    logical_operator: LogicalOperator.and,
    conditions: [] as MetadataFilteringCondition[],
  })
  const [metadataModelConfig, setMetadataModelConfig] = useState<ModelConfig>()
  const queryModeLabelId = 'agent-knowledge-retrieval-query-mode-label'
  const metadataList = useMemo(() => {
    const datasetsWithMetadata = selectedDatasets.filter(dataset => !!dataset.doc_metadata)

    if (datasetsWithMetadata.length === 0)
      return []

    return intersectionBy(...datasetsWithMetadata.map(dataset => dataset.doc_metadata!), 'name')
  }, [selectedDatasets])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[520px] max-h-[calc(100dvh-2rem)] w-[400px] flex-col overflow-hidden p-0">
        <DialogTitle className="sr-only">
          {t('agentDetail.configure.knowledgeRetrieval.dialog.title')}
        </DialogTitle>
        <div className="flex items-center gap-2 px-4 pt-3">
          <KnowledgeRetrievalDialogIcon />
          <Input
            aria-label={t('agentDetail.configure.knowledgeRetrieval.dialog.nameLabel')}
            className="h-7 min-w-0 flex-1 rounded-md px-1 py-0 system-xl-semibold text-text-primary"
            value={name}
            onChange={event => setName(event.currentTarget.value)}
          />
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
                if (nextMode)
                  setQueryMode(nextMode)
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
            <p className="pt-1 system-xs-regular text-text-tertiary">
              {t(`agentDetail.configure.knowledgeRetrieval.dialog.query.${queryMode}Description`)}
            </p>
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
                    onRetrievalModeChange={setRetrievalMode}
                    onMultipleRetrievalConfigChange={setMultipleRetrievalConfig}
                    readonly={!selectedDatasets.length}
                    rerankModalOpen={rerankModelOpen}
                    onRerankModelOpenChange={setRerankModelOpen}
                    selectedDatasets={selectedDatasets}
                  />
                  <div className="h-3 w-px bg-divider-regular" />
                  <AddKnowledge
                    selectedIds={selectedDatasets.map(dataset => dataset.id)}
                    onChange={setSelectedDatasets}
                  />
                </div>
              )}
            >
              <DatasetList
                list={selectedDatasets}
                onChange={setSelectedDatasets}
              />
            </Field>
          </div>

          <div className="py-2">
            <MetadataFilter
              metadataList={metadataList}
              selectedDatasetsLoaded
              metadataFilterMode={metadataFilterMode}
              metadataFilteringConditions={metadataFilteringConditions}
              handleMetadataFilterModeChange={setMetadataFilterMode}
              handleAddCondition={(metadataItem) => {
                setMetadataFilteringConditions(current => ({
                  ...current,
                  conditions: [...current.conditions, createMetadataCondition(metadataItem)],
                }))
              }}
              handleRemoveCondition={(conditionId) => {
                setMetadataFilteringConditions(current => ({
                  ...current,
                  conditions: current.conditions.filter(condition => condition.id !== conditionId),
                }))
              }}
              handleToggleConditionLogicalOperator={() => {
                setMetadataFilteringConditions(current => ({
                  ...current,
                  logical_operator: current.logical_operator === LogicalOperator.and
                    ? LogicalOperator.or
                    : LogicalOperator.and,
                }))
              }}
              handleUpdateCondition={(conditionId, nextCondition) => {
                setMetadataFilteringConditions(current => ({
                  ...current,
                  conditions: current.conditions.map(condition => condition.id === conditionId ? nextCondition : condition),
                }))
              }}
              metadataModelConfig={metadataModelConfig}
              handleMetadataModelChange={(model) => {
                setMetadataModelConfig(current => ({
                  provider: model.provider,
                  name: model.modelId,
                  mode: model.mode ?? current?.mode ?? AppModeEnum.CHAT,
                  completion_params: current?.completion_params ?? { temperature: 0.7 },
                }))
              }}
              handleMetadataCompletionParamsChange={(completionParams) => {
                setMetadataModelConfig(current => ({
                  provider: current?.provider ?? '',
                  name: current?.name ?? '',
                  mode: current?.mode ?? AppModeEnum.CHAT,
                  completion_params: completionParams,
                }))
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 px-4 pb-4">
          <div aria-hidden className="h-2 w-8 border-b border-divider-regular" />
          <a
            href="https://docs.dify.ai/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 system-xs-regular text-text-tertiary hover:text-text-secondary hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className="i-ri-book-read-line size-3 shrink-0" />
            <span className="min-w-0 truncate">
              {t('agentDetail.configure.knowledgeRetrieval.dialog.learnMore')}
            </span>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
