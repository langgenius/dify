import type { FC } from 'react'
import type {
  KnowledgeRetrievalV2MetadataFilters,
  KnowledgeRetrievalV2Mode,
  KnowledgeRetrievalV2NodeKind,
  KnowledgeRetrievalV2NodeType,
} from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useInfiniteQuery } from '@tanstack/react-query'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { consoleQuery } from '@/service/client'
import { parseMetadataFilterValues, toControlSpaceSummary } from './config-helpers'
import { KNOWLEDGE_RETRIEVAL_V2_NODE_KINDS } from './constants'
import useConfig from './use-config'

const i18nPrefix = 'nodes.knowledgeRetrievalV2'
const SPACE_PAGE_SIZE = 50

type MetadataArrayKey = Exclude<
  keyof KnowledgeRetrievalV2MetadataFilters,
  'created_after' | 'created_before' | 'node_kinds'
>

const MetadataValuesInput = ({
  disabled,
  label,
  onCommit,
  value,
}: {
  disabled: boolean
  label: string
  onCommit: (value: string[]) => void
  value?: string[]
}) => (
  <label className="block space-y-1">
    <span className="system-xs-medium text-text-secondary">{label}</span>
    <Input
      key={(value ?? []).join('\u0000')}
      defaultValue={(value ?? []).join(', ')}
      disabled={disabled}
      onBlur={(event) => onCommit(parseMetadataFilterValues(event.currentTarget.value))}
    />
  </label>
)

const Panel: FC<NodePanelProps<KnowledgeRetrievalV2NodeType>> = ({ id, data }) => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const {
    readOnly,
    inputs,
    filterStringVar,
    handleMetadataFilterChange,
    handleModeChange,
    handleNodeKindToggle,
    handleQueryVarChange,
    handleSpaceToggle,
    handleTopNChange,
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
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const visibleSpaces = loadedSpaces.filter((space) => {
    if (!normalizedSearch) return true
    return (space.technical_summary?.name ?? space.control_space_id)
      .toLocaleLowerCase()
      .includes(normalizedSearch)
  })
  const modes: Array<{ label: string; value: KnowledgeRetrievalV2Mode | 'space-default' }> = [
    {
      label: t(($) => $[`${i18nPrefix}.mode.spaceDefault`], { ns: 'workflow' }),
      value: 'space-default',
    },
    { label: t(($) => $[`${i18nPrefix}.mode.fast`], { ns: 'workflow' }), value: 'fast' },
    { label: t(($) => $[`${i18nPrefix}.mode.deep`], { ns: 'workflow' }), value: 'deep' },
    { label: t(($) => $[`${i18nPrefix}.mode.research`], { ns: 'workflow' }), value: 'research' },
  ]
  const selectedMode = modes.find((item) => item.value === (inputs.mode ?? 'space-default'))!
  const metadataArrayFields: Array<{ key: MetadataArrayKey; label: string }> = [
    {
      key: 'document_types',
      label: t(($) => $[`${i18nPrefix}.filters.documentTypes`], { ns: 'workflow' }),
    },
    { key: 'entities', label: t(($) => $[`${i18nPrefix}.filters.entities`], { ns: 'workflow' }) },
    {
      key: 'freshness_statuses',
      label: t(($) => $[`${i18nPrefix}.filters.freshnessStatuses`], { ns: 'workflow' }),
    },
    { key: 'languages', label: t(($) => $[`${i18nPrefix}.filters.languages`], { ns: 'workflow' }) },
    {
      key: 'source_ids',
      label: t(($) => $[`${i18nPrefix}.filters.sourceIds`], { ns: 'workflow' }),
    },
    { key: 'tags', label: t(($) => $[`${i18nPrefix}.filters.tags`], { ns: 'workflow' }) },
  ]

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

        <Field title={t(($) => $[`${i18nPrefix}.knowledgeSpaces`], { ns: 'workflow' })} required>
          <div className="space-y-2">
            <Input
              value={search}
              disabled={readOnly}
              placeholder={t(($) => $[`${i18nPrefix}.spaceSearch`], { ns: 'workflow' })}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-divider-regular p-1.5">
              {visibleSpaces.map((space) => {
                const summary = toControlSpaceSummary(space)
                const selected = inputs.control_space_ids.includes(space.control_space_id)
                const unavailable = space.technical_status !== 'available'
                const atLimit = inputs.control_space_ids.length >= 10 && !selected
                return (
                  <label
                    key={space.control_space_id}
                    className="flex min-h-8 items-center gap-2 rounded-md px-2 hover:bg-state-base-hover"
                  >
                    <Checkbox
                      checked={selected}
                      disabled={readOnly || (unavailable && !selected) || atLimit}
                      onCheckedChange={() => handleSpaceToggle(summary)}
                    />
                    <span aria-hidden>{summary.icon || '📗'}</span>
                    <span className="w-0 grow truncate system-sm-regular text-text-secondary">
                      {summary.name}
                    </span>
                    {unavailable && (
                      <span className="system-xs-regular text-text-warning">
                        {t(($) => $[`${i18nPrefix}.unavailable`], { ns: 'workflow' })}
                      </span>
                    )}
                  </label>
                )
              })}
              {!spacesQuery.isLoading && visibleSpaces.length === 0 && (
                <div className="px-2 py-3 text-center system-xs-regular text-text-tertiary">
                  {t(($) => $[`${i18nPrefix}.noSpaces`], { ns: 'workflow' })}
                </div>
              )}
            </div>
            {spacesQuery.hasNextPage && (
              <button
                type="button"
                className="system-xs-medium text-text-accent"
                disabled={spacesQuery.isFetchingNextPage}
                onClick={() => spacesQuery.fetchNextPage()}
              >
                {t(($) => $[`${i18nPrefix}.loadMore`], { ns: 'workflow' })}
              </button>
            )}
            <div className="system-xs-regular text-text-tertiary">
              {inputs.control_space_ids.length}/10
            </div>
          </div>
        </Field>

        {selectedSummaries.length > 0 && (
          <div className="space-y-1 rounded-lg bg-background-section-burn p-2">
            <div className="system-xs-medium text-text-secondary">
              {t(($) => $[`${i18nPrefix}.profileManagedBySpace`], { ns: 'workflow' })}
            </div>
            {selectedSummaries.map((space) => (
              <div key={space.control_space_id} className="system-xs-regular text-text-tertiary">
                {space.name}: {space.default_mode ?? '—'} ·{' '}
                {t(($) => $[`${i18nPrefix}.profile.topK`], { ns: 'workflow' })} {space.top_k ?? '—'}{' '}
                · {t(($) => $[`${i18nPrefix}.profile.rerank`], { ns: 'workflow' })}{' '}
                {space.rerank_enabled === undefined
                  ? '—'
                  : space.rerank_enabled
                    ? t(($) => $[`${i18nPrefix}.profile.on`], { ns: 'workflow' })
                    : t(($) => $[`${i18nPrefix}.profile.off`], { ns: 'workflow' })}
              </div>
            ))}
          </div>
        )}

        <Field title={t(($) => $[`${i18nPrefix}.mode.title`], { ns: 'workflow' })}>
          <div>
            <Select
              value={selectedMode.value}
              disabled={readOnly}
              onValueChange={(value) => {
                if (!value) return
                handleModeChange(
                  value === 'space-default' ? undefined : (value as KnowledgeRetrievalV2Mode),
                )
              }}
            >
              <SelectTrigger className="w-full">{selectedMode.label}</SelectTrigger>
              <SelectContent>
                {modes.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    <SelectItemText>{mode.label}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {inputs.mode === 'research' && (
              <div className="mt-1 system-xs-regular text-text-warning">
                {t(($) => $[`${i18nPrefix}.mode.researchHint`], { ns: 'workflow' })}
              </div>
            )}
          </div>
        </Field>

        <Field title={t(($) => $[`${i18nPrefix}.topN`], { ns: 'workflow' })}>
          <Input
            type="number"
            min={1}
            max={100}
            value={inputs.top_n}
            disabled={readOnly}
            onChange={(event) => handleTopNChange(Number(event.currentTarget.value))}
          />
        </Field>

        <Field title={t(($) => $[`${i18nPrefix}.filters.title`], { ns: 'workflow' })}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="system-xs-medium text-text-secondary">
                  {t(($) => $[`${i18nPrefix}.filters.createdAfter`], { ns: 'workflow' })}
                </span>
                <Input
                  type="datetime-local"
                  value={inputs.metadata_filters?.created_after ?? ''}
                  disabled={readOnly}
                  onChange={(event) =>
                    handleMetadataFilterChange(
                      'created_after',
                      event.currentTarget.value || undefined,
                    )
                  }
                />
              </label>
              <label className="space-y-1">
                <span className="system-xs-medium text-text-secondary">
                  {t(($) => $[`${i18nPrefix}.filters.createdBefore`], { ns: 'workflow' })}
                </span>
                <Input
                  type="datetime-local"
                  value={inputs.metadata_filters?.created_before ?? ''}
                  disabled={readOnly}
                  onChange={(event) =>
                    handleMetadataFilterChange(
                      'created_before',
                      event.currentTarget.value || undefined,
                    )
                  }
                />
              </label>
            </div>
            {metadataArrayFields.map((field) => (
              <MetadataValuesInput
                key={field.key}
                disabled={readOnly}
                label={field.label}
                value={inputs.metadata_filters?.[field.key]}
                onCommit={(value) => handleMetadataFilterChange(field.key, value)}
              />
            ))}
            <div className="space-y-1">
              <div className="system-xs-medium text-text-secondary">
                {t(($) => $[`${i18nPrefix}.filters.nodeKinds`], { ns: 'workflow' })}
              </div>
              <div className="flex flex-wrap gap-2">
                {KNOWLEDGE_RETRIEVAL_V2_NODE_KINDS.map((nodeKind) => (
                  <label
                    key={nodeKind}
                    className="flex items-center gap-1.5 system-xs-regular text-text-secondary"
                  >
                    <Checkbox
                      checked={inputs.metadata_filters?.node_kinds?.includes(nodeKind)}
                      disabled={readOnly}
                      onCheckedChange={() =>
                        handleNodeKindToggle(nodeKind as KnowledgeRetrievalV2NodeKind)
                      }
                    />
                    {nodeKind}
                  </label>
                ))}
              </div>
            </div>
            <div className="system-xs-regular text-text-tertiary">
              {t(($) => $[`${i18nPrefix}.filters.hint`], { ns: 'workflow' })}
            </div>
          </div>
        </Field>
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
