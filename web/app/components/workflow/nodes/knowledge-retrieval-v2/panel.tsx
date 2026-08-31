import type { FC } from 'react'
import type { KnowledgeRetrievalV2NodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { useInfiniteQuery, useQueries } from '@tanstack/react-query'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import MetadataFilter from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { consoleQuery } from '@/service/client'
import { knowledgeFsMetadataFieldsQueryOptions } from '@/service/knowledge-fs/metadata'
import AddKnowledgeSpace from './components/add-knowledge-space'
import KnowledgeSpaceList from './components/knowledge-space-list'
import RecallSettings from './components/recall-settings'
import { toControlSpaceSummary } from './config-helpers'
import { intersectKnowledgeFsMetadataFields } from './metadata-filtering'
import useConfig from './use-config'

const i18nPrefix = 'nodes.knowledgeRetrievalV2'
const SPACE_PAGE_SIZE = 50
const KNOWLEDGE_FS_METADATA_FILTER_MODES = [
  MetadataFilteringModeEnum.disabled,
  MetadataFilteringModeEnum.manual,
] as const

const Panel: FC<NodePanelProps<KnowledgeRetrievalV2NodeType>> = ({ id, data }) => {
  const { t } = useTranslation()
  const {
    readOnly,
    inputs,
    availableNumberNodesWithParent,
    availableNumberVars,
    availableStringNodesWithParent,
    availableStringVars,
    filterStringVar,
    handleAddCondition,
    handleMetadataFilterModeChange,
    handleModeChange,
    handleQueryVarChange,
    handleRerankingModelChange,
    handleRemoveCondition,
    handleScoreThresholdChange,
    handleSpacesChange,
    handleTopNChange,
    handleToggleConditionLogicalOperator,
    handleUpdateCondition,
  } = useConfig(id, data)
  const spacesQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
      input: (pageParam) => ({ query: { limit: SPACE_PAGE_SIZE, page: pageParam } }),
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
      initialPageParam: 1,
    }),
  )
  const loadedSpaces = useMemo(
    () => spacesQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [spacesQuery.data?.pages],
  )
  const loadedSummaries = useMemo(() => loadedSpaces.map(toControlSpaceSummary), [loadedSpaces])
  const metadataQueries = useQueries({
    queries: inputs.control_space_ids.map((controlSpaceId) =>
      knowledgeFsMetadataFieldsQueryOptions(controlSpaceId),
    ),
  })
  const metadataList = intersectKnowledgeFsMetadataFields(
    metadataQueries.map((query) => query.data ?? []),
  )
  const selectedSpacesMetadataLoaded =
    inputs.control_space_ids.length > 0 && metadataQueries.every((query) => query.isSuccess)
  const loadedSummaryMap = useMemo(
    () => new Map(loadedSummaries.map((space) => [space.control_space_id, space])),
    [loadedSummaries],
  )
  const selectedSummaries = inputs.control_space_ids.map(
    (controlSpaceId) =>
      loadedSummaryMap.get(controlSpaceId) ??
      inputs._control_spaces?.find((space) => space.control_space_id === controlSpaceId) ?? {
        control_space_id: controlSpaceId,
        name: controlSpaceId,
      },
  )
  const metadataFilterMode =
    inputs.metadata_filtering_mode === MetadataFilteringModeEnum.manual
      ? MetadataFilteringModeEnum.manual
      : MetadataFilteringModeEnum.disabled

  return (
    <div className="pt-2">
      <div className="space-y-4 px-4 pb-4">
        <Field title={t(($) => $[`${i18nPrefix}.queryText`], { ns: 'workflow' })} required>
          <VarReferencePicker
            nodeId={id}
            readonly={readOnly}
            isShowNodeName
            value={inputs.query_variable_selector}
            onChange={handleQueryVarChange}
            filterVar={filterStringVar}
          />
        </Field>

        <Field
          title={t(($) => $[`${i18nPrefix}.knowledgeSpaces`], { ns: 'workflow' })}
          required
          operations={
            <div className="flex items-center space-x-1">
              <RecallSettings
                mode={inputs.mode}
                topK={inputs.top_n}
                scoreThreshold={inputs.score_threshold}
                rerankingModel={inputs.reranking_model}
                readonly={readOnly || !selectedSummaries.length}
                onModeChange={handleModeChange}
                onTopKChange={handleTopNChange}
                onScoreThresholdChange={handleScoreThresholdChange}
                onRerankingModelChange={handleRerankingModelChange}
              />
              {!readOnly && <div className="h-3 w-px bg-divider-regular" />}
              {!readOnly && (
                <AddKnowledgeSpace
                  selectedSpaces={selectedSummaries}
                  onChange={handleSpacesChange}
                />
              )}
            </div>
          }
        >
          <KnowledgeSpaceList
            list={selectedSummaries}
            readonly={readOnly}
            onChange={handleSpacesChange}
          />
        </Field>
      </div>

      <div className="mb-2 py-2">
        <MetadataFilter
          allowedModes={KNOWLEDGE_FS_METADATA_FILTER_MODES}
          metadataList={metadataList}
          selectedDatasetsLoaded={selectedSpacesMetadataLoaded}
          metadataFilterMode={metadataFilterMode}
          metadataFilteringConditions={inputs.metadata_filtering_conditions}
          handleAddCondition={handleAddCondition}
          handleMetadataFilterModeChange={handleMetadataFilterModeChange}
          handleRemoveCondition={handleRemoveCondition}
          handleToggleConditionLogicalOperator={handleToggleConditionLogicalOperator}
          handleUpdateCondition={handleUpdateCondition}
          availableStringVars={availableStringVars}
          availableStringNodesWithParent={availableStringNodesWithParent}
          availableNumberVars={availableNumberVars}
          availableNumberNodesWithParent={availableNumberNodesWithParent}
        />
      </div>

      <Split />
      <OutputVars>
        <VarItem
          name="result"
          type="Array[Object]"
          description={t(($) => $[`${i18nPrefix}.outputVars.result`], { ns: 'workflow' })}
          subItems={[
            {
              name: 'content',
              type: 'string',
              description: t(($) => $[`${i18nPrefix}.outputVars.content`], { ns: 'workflow' }),
            },
            {
              name: 'title',
              type: 'string',
              description: t(($) => $[`${i18nPrefix}.outputVars.title`], { ns: 'workflow' }),
            },
            {
              name: 'metadata',
              type: 'object',
              description: t(($) => $[`${i18nPrefix}.outputVars.metadata`], { ns: 'workflow' }),
            },
          ]}
        />
        <VarItem
          name="metrics"
          type="object"
          description={t(($) => $[`${i18nPrefix}.outputVars.metrics`], { ns: 'workflow' })}
          subItems={[
            {
              name: 'mode',
              type: 'string',
              description: t(($) => $[`${i18nPrefix}.outputVars.mode`], { ns: 'workflow' }),
            },
            {
              name: 'total_ms',
              type: 'number',
              description: t(($) => $[`${i18nPrefix}.outputVars.totalMs`], { ns: 'workflow' }),
            },
            {
              name: 'degradation_flags',
              type: 'Array[string]',
              description: t(($) => $[`${i18nPrefix}.outputVars.degradationFlags`], {
                ns: 'workflow',
              }),
            },
          ]}
        />
      </OutputVars>
    </div>
  )
}

export default memo(Panel)
