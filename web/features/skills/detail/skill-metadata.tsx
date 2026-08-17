'use client'

import type {
  SkillDetailResponse,
  SkillReferenceResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { SkillFileMutationCoordinator } from './shared'
import type { TagComboboxItem } from '@/features/tag-management/components/tag-combobox-item'
import type { AppIconType } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
} from '@langgenius/dify-ui/combobox'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { isCreateTagOption } from '@/features/tag-management/components/tag-combobox-item'
import { TagManagementModal } from '@/features/tag-management/components/tag-management-modal'
import { TagSearchContentView } from '@/features/tag-management/components/tag-search-content'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { SkillPublishShortcut } from './publish-bar'
import {
  invalidateSkillDetail,
  runSkillFileMutation,
  SKILL_TAG_CREATE_OPTION_PREFIX,
} from './shared'

export function SkillTagsEditor({
  detail,
  fileMutationCoordinator,
  readonly,
  skillId,
}: {
  detail: SkillDetailResponse | undefined
  fileMutationCoordinator: SkillFileMutationCoordinator
  readonly: boolean
  skillId: string
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [showTagManagement, setShowTagManagement] = useState(false)
  const [tagSearch, setTagSearch] = useState('')
  const [draftTags, setDraftTags] = useState<string[]>([])
  const persistedTags = useMemo(() => detail?.tags ?? [], [detail?.tags])
  const tags = persistedTags
  const metadataMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.patch.mutationOptions(),
  )
  const tagsQuery = useQuery(consoleQuery.workspaces.current.skills.tags.get.queryOptions())
  const normalizedTagSearch = tagSearch.trim()
  const tagOptions = useMemo<TagComboboxItem[]>(() => {
    const options: TagComboboxItem[] = []
    const seenTags = new Set<string>()
    const addOption = (tag: string) => {
      const normalizedTag = tag.trim()
      const tagKey = normalizedTag.toLocaleLowerCase()
      if (!normalizedTag || seenTags.has(tagKey)) return

      seenTags.add(tagKey)
      options.push({
        id: `skill-tag:${tagKey}`,
        name: normalizedTag,
        type: 'skill',
        binding_count: '0',
      })
    }

    for (const tag of tags) addOption(tag)
    for (const tag of tagsQuery.data?.data ?? []) addOption(tag.tag)
    for (const tag of draftTags) addOption(tag)
    const hasExactMatch = options.some(
      (tag) => tag.name.toLocaleLowerCase() === normalizedTagSearch.toLocaleLowerCase(),
    )
    if (normalizedTagSearch && !hasExactMatch) {
      options.push({
        id: `${SKILL_TAG_CREATE_OPTION_PREFIX}${normalizedTagSearch}`,
        name: normalizedTagSearch,
        type: 'skill',
        binding_count: '0',
        isCreateOption: true,
      })
    }

    return options
  }, [draftTags, normalizedTagSearch, tags, tagsQuery.data?.data])

  const saveTags = (nextTags: string[]) => {
    if (!detail || metadataMutation.isPending) return

    void runSkillFileMutation(fileMutationCoordinator, (expectedUpdatedAt) =>
      metadataMutation.mutateAsync({
        params: {
          skill_id: skillId,
        },
        body: {
          expected_updated_at: expectedUpdatedAt,
          tags: nextTags,
        },
      }),
    )
      .then(() => {
        const addedTag = nextTags.some((tag) => !tags.includes(tag))
        toast.success(
          addedTag
            ? t(($) => $['skillManagement.detail.addTagSuccess'])
            : t(($) => $['skillManagement.detail.removeTagSuccess']),
        )
        invalidateSkillDetail(queryClient, skillId)
        void queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.skills.tags.get.key({ type: 'query' }),
        })
        void queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
        })
      })
      .catch(() => {
        invalidateSkillDetail(queryClient, skillId)
        toast.error(t(($) => $['skillManagement.detail.updateTagsFailed']))
      })
  }

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setDraftTags(tags)
      setTagSearch('')
      setAddOpen(true)
      return
    }

    setAddOpen(false)
    setTagSearch('')
    const draftTagSet = new Set(draftTags)
    const tagsChanged =
      tags.length !== draftTags.length || tags.some((tag) => !draftTagSet.has(tag))
    if (tagsChanged) saveTags(draftTags)
  }

  const renderTagBadge = (tag: string) => (
    <span
      key={tag}
      className="group/tag relative flex max-w-full min-w-[18px] items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px] system-2xs-medium-uppercase text-text-tertiary"
    >
      <span className="min-w-0 truncate">{tag}</span>
      {!readonly && (
        <button
          type="button"
          aria-label={t(($) => $['skillManagement.detail.removeTag'], { tag })}
          className="flex h-3 max-w-0 shrink-0 cursor-pointer items-center justify-center overflow-hidden text-text-quaternary opacity-0 outline-hidden transition-[max-width,margin,opacity] group-hover/tag:ml-0.5 group-hover/tag:max-w-3 group-hover/tag:opacity-100 hover:text-text-secondary focus-visible:ml-0.5 focus-visible:max-w-3 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={() => saveTags(tags.filter((currentTag) => currentTag !== tag))}
        >
          <span aria-hidden className="i-ri-close-line size-3" />
        </button>
      )}
    </span>
  )

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {tags.map(renderTagBadge)}
        {!readonly && (
          <Combobox<TagComboboxItem, true>
            items={tagOptions}
            multiple
            open={addOpen}
            onOpenChange={handleOpenChange}
            value={tagOptions.filter(
              (tag) => !isCreateTagOption(tag) && draftTags.includes(tag.name),
            )}
            onValueChange={(nextTags) => {
              const createOption = nextTags.find(isCreateTagOption)
              if (createOption) {
                setDraftTags((currentTags) => [...currentTags, createOption.name])
                setTagSearch('')
                return
              }

              setDraftTags(nextTags.filter((tag) => !isCreateTagOption(tag)).map((tag) => tag.name))
            }}
            inputValue={tagSearch}
            onInputValueChange={setTagSearch}
            filter={(tag, query) =>
              tag.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
            }
            itemToStringLabel={(tag) => tag.name}
            isItemEqualToValue={(item, value) => item.id === value.id}
          >
            <ComboboxTrigger
              icon={false}
              disabled={!detail}
              aria-label={t(($) => $['skillManagement.detail.addTag'])}
              className={cn(
                'h-[18px] w-auto min-w-[18px] rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm p-0 text-text-tertiary hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt data-popup-open:bg-state-base-hover',
                tags.length === 0 && 'border-dashed px-[5px]',
              )}
            >
              <span className="flex items-center justify-center gap-0.5 system-2xs-medium-uppercase">
                <span aria-hidden className="i-ri-add-line size-3 shrink-0" />
                {tags.length === 0 && t(($) => $['skillManagement.detail.addTag'])}
              </span>
            </ComboboxTrigger>
            <ComboboxPortal>
              <ComboboxPositioner placement="bottom-start" sideOffset={4}>
                <ComboboxPopup
                  aria-label={t(($) => $['skillManagement.detail.addTag'])}
                  className="w-(--anchor-width) min-w-60 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-[5px]"
                >
                  <TagSearchContentView
                    type="skill"
                    inputValue={tagSearch}
                    onInputValueChange={setTagSearch}
                    canBindOrUnbindTags
                    canManageTags
                    onOpenTagManagement={() => setShowTagManagement(true)}
                    onClose={() => handleOpenChange(false)}
                  />
                </ComboboxPopup>
              </ComboboxPositioner>
            </ComboboxPortal>
          </Combobox>
        )}
        {readonly && tags.length === 0 && (
          <span className="system-2xs-medium-uppercase text-text-quaternary">
            {tCommon(($) => $['tag.noTag'])}
          </span>
        )}
      </div>
      <TagManagementModal
        type="skill"
        show={showTagManagement}
        onClose={() => setShowTagManagement(false)}
        onTagsChange={() => {
          invalidateSkillDetail(queryClient, skillId)
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.skills.tags.get.key({ type: 'query' }),
          })
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
          })
        }}
      />
    </>
  )
}

export function SkillReferencesPanel({
  compact = false,
  embedded = false,
  enabled = true,
  maxHeight,
  skillId,
  testId,
  visibleLimit,
}: {
  compact?: boolean
  embedded?: boolean
  enabled?: boolean
  maxHeight?: string
  skillId: string
  testId?: string
  visibleLimit?: number
}) {
  const { t } = useTranslation('skill')
  const referencesQuery = useQuery({
    ...consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
      input: {
        params: {
          skill_id: skillId,
        },
      },
      enabled,
    }),
    refetchOnMount: 'always',
  })
  const references = referencesQuery.data?.data ?? []

  if (referencesQuery.isPending) {
    return <SkillReferencesListSkeleton compact={compact} embedded={embedded} />
  }

  if (references.length === 0) {
    return (
      <div
        className={cn(
          'py-2 system-xs-regular text-text-quaternary',
          embedded ? 'w-full px-1' : 'w-max',
        )}
      >
        {t(($) => $['skillManagement.detail.referencedBy_other'], { count: 0 })}
      </div>
    )
  }

  return (
    <SkillReferencesList
      compact={compact}
      embedded={embedded}
      maxHeight={maxHeight}
      references={references}
      testId={testId}
      visibleLimit={visibleLimit}
    />
  )
}

export function SkillReferencesListSkeleton({
  compact = false,
  embedded = false,
}: {
  compact?: boolean
  embedded?: boolean
}) {
  return (
    <div
      className={cn(
        compact
          ? cn('space-y-px', !embedded && 'rounded-xl border border-divider-subtle p-1')
          : 'w-52 space-y-1 py-1',
      )}
    >
      <SkeletonRectangle className={cn(compact ? 'h-7 rounded-md' : 'h-8 rounded-lg')} />
      <SkeletonRectangle className={cn(compact ? 'h-7 rounded-md' : 'h-8 rounded-lg')} />
      {compact && <SkeletonRectangle className="h-7 rounded-md" />}
    </div>
  )
}

export function SkillReferencesList({
  compact = false,
  embedded = false,
  maxHeight,
  references,
  testId,
  visibleLimit,
}: {
  compact?: boolean
  embedded?: boolean
  maxHeight?: string
  references: SkillReferenceResponse[]
  testId?: string
  visibleLimit?: number
}) {
  const { t } = useTranslation('skill')
  const [expanded, setExpanded] = useState(false)
  const hasMoreReferences = visibleLimit != null && references.length > visibleLimit
  const visibleReferences =
    hasMoreReferences && !expanded ? references.slice(0, visibleLimit) : references
  const isScrollable = Boolean(maxHeight && (expanded || visibleLimit == null))

  return (
    <div
      data-testid={testId}
      data-scrollable={isScrollable ? true : undefined}
      className={cn(
        compact
          ? cn(
              'flex flex-col gap-px',
              !embedded && 'rounded-xl border border-divider-subtle p-[3px]',
            )
          : 'w-max max-w-[480px] space-y-0.5 py-1',
        isScrollable && `${maxHeight} overflow-y-auto`,
      )}
    >
      {visibleReferences.map((reference) => (
        <SkillReferenceItem
          key={`${reference.type}:${reference.agent_id}:${reference.workflow_id ?? ''}:${reference.node_id ?? ''}`}
          compact={compact}
          reference={reference}
        />
      ))}
      {hasMoreReferences && !expanded && (
        <button
          type="button"
          className={cn(
            'flex h-7 cursor-pointer items-center justify-center rounded-md px-2 system-xs-medium text-text-accent outline-hidden hover:bg-state-accent-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
            !compact && 'w-full',
          )}
          onClick={() => setExpanded(true)}
        >
          {t(($) => $['skillManagement.detail.showMoreReferences'], {
            count: references.length - visibleReferences.length,
          })}
        </button>
      )}
    </div>
  )
}

export function SkillPublishConfirmPanel({
  loading,
  onCancel,
  onConfirm,
  open,
  referenceCount,
  skillId,
}: {
  loading: boolean
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  referenceCount: number
  skillId: string
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-labelledby="skill-publish-confirm-title"
      data-open
      className="pointer-events-auto relative flex w-96 max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl bg-components-panel-bg-blur shadow-lg inset-ring-[0.5px] shadow-shadow-shadow-5 inset-ring-components-panel-border backdrop-blur-[5px]"
    >
      <div className="px-3 pt-3.5 pb-1">
        <h2
          id="skill-publish-confirm-title"
          className="px-1 pr-8 system-xl-semibold text-text-primary"
        >
          {t(($) => $['skillManagement.detail.publishReferencesTitle'])}
        </h2>
        <p className="mt-0.5 px-1 system-xs-regular text-util-colors-warning-warning-600">
          {t(
            ($) =>
              referenceCount === 1
                ? $['skillManagement.detail.publishReferencesDescription_one']
                : $['skillManagement.detail.publishReferencesDescription_other'],
            { count: referenceCount },
          )}
        </p>
      </div>
      <div className="px-4 py-2">
        <SkillReferencesPanel
          compact
          enabled={open}
          maxHeight="max-h-[240px]"
          skillId={skillId}
          testId="skill-publish-reference-list"
          visibleLimit={5}
        />
      </div>
      <div className="flex items-center justify-end gap-2 px-4 pt-2 pb-4">
        <Button className="h-8 min-w-[72px] rounded-lg px-3" disabled={loading} onClick={onCancel}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button
          className="h-8 gap-1 rounded-lg px-3"
          variant="primary"
          loading={loading}
          onClick={onConfirm}
        >
          <span>{t(($) => $['skillManagement.detail.publishUpdate'])}</span>
          <SkillPublishShortcut />
        </Button>
      </div>
    </div>
  )
}

function SkillReferenceItem({
  compact = false,
  reference,
}: {
  compact?: boolean
  reference: SkillReferenceResponse
}) {
  const isWorkflowAgent = reference.type === 'workflow_agent_node'
  const agentIconType = reference.agent_icon_type as AppIconType | null | undefined
  const agentImageUrl =
    reference.agent_icon_type === 'image' || reference.agent_icon_type === 'link'
      ? reference.agent_icon
      : undefined

  if (!isWorkflowAgent) {
    const title = reference.display_name || reference.name
    return (
      <Link
        href={`/agents/${reference.agent_id}/configure`}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'group/reference flex min-w-0 items-center gap-2 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          compact
            ? 'h-7 w-full rounded-md py-1 pr-2 pl-1'
            : 'h-8 w-fit max-w-[480px] rounded-lg px-2',
        )}
      >
        <span aria-hidden className="shrink-0">
          <AppIcon
            size="tiny"
            iconType={agentIconType}
            icon={reference.agent_icon ?? undefined}
            background={reference.agent_icon_background}
            imageUrl={agentImageUrl}
            innerIcon={
              agentIconType ? undefined : (
                <span className="i-ri-robot-2-line size-4 text-util-colors-blue-blue-600" />
              )
            }
          />
        </span>
        <span
          className={cn(
            'min-w-0 truncate system-sm-regular text-text-secondary',
            compact ? 'flex-1' : 'max-w-[252px]',
          )}
        >
          {title}
        </span>
        <span
          aria-hidden
          className={cn(
            'i-ri-external-link-line shrink-0 text-text-quaternary group-hover/reference:text-text-secondary group-focus-visible/reference:text-text-secondary',
            compact ? 'size-3' : 'size-4',
          )}
        />
      </Link>
    )
  }

  const workflowName = reference.workflow_name || reference.display_name || reference.name
  const workflowIconType = reference.workflow_icon_type as AppIconType | null | undefined
  const workflowImageUrl =
    reference.workflow_icon_type === 'image' || reference.workflow_icon_type === 'link'
      ? reference.workflow_icon
      : undefined
  const workflowContent = (
    <>
      <span aria-hidden className="shrink-0">
        <AppIcon
          size="tiny"
          iconType={workflowIconType}
          icon={reference.workflow_icon ?? undefined}
          background={reference.workflow_icon_background}
          imageUrl={workflowImageUrl}
          innerIcon={
            workflowIconType ? undefined : (
              <span className="i-ri-flow-chart size-4 text-util-colors-blue-blue-600" />
            )
          }
        />
      </span>
      <span className="max-w-[252px] min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
        {workflowName}
      </span>
      <span
        aria-hidden
        className={cn(
          'i-ri-external-link-line shrink-0 text-text-quaternary group-hover/reference:text-text-secondary group-focus-visible/reference:text-text-secondary',
          compact ? 'size-3' : 'size-4',
        )}
      />
    </>
  )

  if (reference.app_id) {
    return (
      <Link
        href={`/app/${reference.app_id}/workflow`}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'group/reference flex min-w-0 items-center gap-2 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          compact
            ? 'h-7 w-full rounded-md py-1 pr-2 pl-1'
            : 'h-8 w-fit max-w-[480px] rounded-lg px-2',
        )}
      >
        {workflowContent}
      </Link>
    )
  }

  return (
    <div
      className={cn(
        'group/reference flex min-w-0 items-center gap-2 hover:bg-state-base-hover',
        compact
          ? 'h-7 w-full rounded-md py-1 pr-2 pl-1'
          : 'h-8 w-fit max-w-[480px] rounded-lg px-2',
      )}
    >
      {workflowContent}
    </div>
  )
}
