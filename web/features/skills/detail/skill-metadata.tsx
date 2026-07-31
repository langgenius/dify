'use client'

import type {
  SkillDetailResponse,
  SkillReferenceResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { SkillFileMutationCoordinator } from './shared'
import type { AppIconType } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemText,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
} from '@langgenius/dify-ui/combobox'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { TagManagementModal } from '@/features/tag-management/components/tag-management-modal'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
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
  const { t } = useTranslation('agentV2')
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
  const tagOptions = useMemo(() => {
    const options: string[] = []
    const seenTags = new Set<string>()
    const addOption = (tag: string) => {
      const normalizedTag = tag.trim()
      const tagKey = normalizedTag.toLocaleLowerCase()
      if (!normalizedTag || seenTags.has(tagKey)) return

      seenTags.add(tagKey)
      options.push(normalizedTag)
    }

    for (const tag of tags) addOption(tag)
    for (const tag of tagsQuery.data?.data ?? []) addOption(tag.tag)
    for (const tag of draftTags) addOption(tag)
    const hasExactMatch = options.some(
      (tag) => tag.toLocaleLowerCase() === normalizedTagSearch.toLocaleLowerCase(),
    )
    if (normalizedTagSearch && !hasExactMatch)
      options.push(`${SKILL_TAG_CREATE_OPTION_PREFIX}${normalizedTagSearch}`)

    return options
  }, [draftTags, normalizedTagSearch, tags, tagsQuery.data?.data])

  const getTagOptionLabel = (tag: string) =>
    tag.startsWith(SKILL_TAG_CREATE_OPTION_PREFIX)
      ? tag.slice(SKILL_TAG_CREATE_OPTION_PREFIX.length)
      : tag

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
          <Combobox<string, true>
            items={tagOptions}
            multiple
            open={addOpen}
            onOpenChange={handleOpenChange}
            value={draftTags}
            onValueChange={(nextTags) => {
              const createOption = nextTags.find((tag) =>
                tag.startsWith(SKILL_TAG_CREATE_OPTION_PREFIX),
              )
              if (createOption) {
                setDraftTags((currentTags) => [...currentTags, getTagOptionLabel(createOption)])
                setTagSearch('')
                return
              }

              setDraftTags(
                tagOptions.filter(
                  (tag) =>
                    !tag.startsWith(SKILL_TAG_CREATE_OPTION_PREFIX) && nextTags.includes(tag),
                ),
              )
            }}
            inputValue={tagSearch}
            onInputValueChange={setTagSearch}
            filter={(tag, query) =>
              getTagOptionLabel(tag).toLocaleLowerCase().includes(query.toLocaleLowerCase())
            }
            itemToStringLabel={getTagOptionLabel}
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
            <ComboboxContent
              placement="bottom-start"
              sideOffset={4}
              popupClassName="w-[232px] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-[5px]"
            >
              <div className="p-2 pb-1">
                <ComboboxInputGroup className="h-8 border-divider-subtle bg-components-input-bg-normal shadow-none">
                  <span
                    aria-hidden
                    className="ml-2 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
                  />
                  <ComboboxInput
                    aria-label={tCommon(($) => $['tag.selectorPlaceholder'])}
                    placeholder={tCommon(($) => $['tag.selectorPlaceholder'])}
                    className="pl-2"
                  />
                  {tagSearch && (
                    <button
                      type="button"
                      aria-label={tCommon(($) => $['operation.clear'])}
                      className="mr-1.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-components-input-bg-hover hover:text-text-secondary focus-visible:bg-components-input-bg-hover focus-visible:text-text-secondary focus-visible:inset-ring-1 focus-visible:inset-ring-components-input-border-active"
                      onClick={() => setTagSearch('')}
                      onPointerDown={(event) => event.preventDefault()}
                    >
                      <span aria-hidden className="i-ri-close-line size-4" />
                    </button>
                  )}
                </ComboboxInputGroup>
              </div>
              <ComboboxList<string> className="max-h-58">
                {(tag) => {
                  if (tag.startsWith(SKILL_TAG_CREATE_OPTION_PREFIX)) {
                    const tagName = getTagOptionLabel(tag)
                    return (
                      <ComboboxItem key={tag} value={tag} className="grid-cols-[1fr]">
                        <ComboboxItemText className="flex items-center gap-1 px-0">
                          <span
                            aria-hidden
                            className="i-ri-add-line size-4 shrink-0 text-text-tertiary"
                          />
                          <span className="min-w-0 grow truncate px-1 system-md-regular text-text-secondary">
                            {`${tCommon(($) => $['tag.create'])} `}
                            <span className="system-md-medium">{`'${tagName}'`}</span>
                          </span>
                        </ComboboxItemText>
                      </ComboboxItem>
                    )
                  }

                  const selected = draftTags.includes(tag)
                  return (
                    <ComboboxItem key={tag} value={tag} className="grid-cols-[auto_1fr] gap-1">
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded-sm shadow-xs',
                          selected
                            ? 'bg-components-checkbox-bg text-components-checkbox-icon'
                            : 'border border-components-checkbox-border bg-components-checkbox-bg-unchecked',
                        )}
                      >
                        {selected && <span className="i-ri-check-line size-3" />}
                      </span>
                      <ComboboxItemText className="system-md-regular">{tag}</ComboboxItemText>
                    </ComboboxItem>
                  )
                }}
              </ComboboxList>
              <ComboboxEmpty>{tCommon(($) => $['tag.noTag'])}</ComboboxEmpty>
              <ComboboxSeparator className="my-0" />
              <div className="p-1">
                <button
                  type="button"
                  className="flex h-8 w-full cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-left text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  aria-label={tCommon(($) => $['tag.manageTags'])}
                  onClick={() => {
                    handleOpenChange(false)
                    setShowTagManagement(true)
                  }}
                >
                  <span
                    aria-hidden
                    className="i-ri-price-tag-3-line size-4 shrink-0 text-text-tertiary"
                  />
                  <span className="min-w-0 grow truncate px-1 system-md-regular">
                    {tCommon(($) => $['tag.manageTags'])}
                  </span>
                </button>
              </div>
            </ComboboxContent>
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

export function SkillReferencesPanel({ skillId }: { referenceCount: number; skillId: string }) {
  const { t } = useTranslation('agentV2')
  const referencesQuery = useQuery(
    consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
      input: {
        params: {
          skill_id: skillId,
        },
      },
    }),
  )
  const references = referencesQuery.data?.data ?? []

  if (referencesQuery.isPending) {
    return (
      <div className="w-52 space-y-1 py-1">
        <SkeletonRectangle className="h-8 rounded-lg" />
        <SkeletonRectangle className="h-8 rounded-lg" />
      </div>
    )
  }

  if (references.length === 0) {
    return (
      <div className="w-max py-2 system-xs-regular text-text-quaternary">
        {t(($) => $['skillManagement.detail.referencedBy'], { count: 0 })}
      </div>
    )
  }

  return (
    <div className="w-max max-w-[480px] space-y-0.5 py-1">
      {references.map((reference) => (
        <SkillReferenceItem
          key={`${reference.type}:${reference.agent_id}:${reference.workflow_id ?? ''}:${reference.node_id ?? ''}`}
          reference={reference}
        />
      ))}
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
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const referencesQuery = useQuery(
    consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
      input: {
        params: {
          skill_id: skillId,
        },
      },
      enabled: open,
    }),
  )
  const references = referencesQuery.data?.data ?? []

  if (!open) return null

  return (
    <div className="absolute right-0 bottom-[calc(100%+10px)] z-50 w-[420px] overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg shadow-xl">
      <div className="px-6 pt-5 pb-4">
        <h2 className="title-xl-semi-bold text-text-primary">
          {t(($) => $['skillManagement.detail.publishReferencesTitle'])}
        </h2>
        <p className="mt-2 system-sm-regular text-util-colors-warning-warning-600">
          {t(($) => $['skillManagement.detail.publishReferencesDescription'], {
            count: referenceCount,
          })}
        </p>
      </div>
      <div className="px-5 pb-5">
        {referencesQuery.isPending ? (
          <div className="space-y-1">
            <SkeletonRectangle className="h-8 rounded-lg" />
            <SkeletonRectangle className="h-8 rounded-lg" />
            <SkeletonRectangle className="h-8 rounded-lg" />
          </div>
        ) : (
          <div className="max-h-36 overflow-y-auto rounded-xl border border-divider-subtle py-1">
            {references.map((reference) => (
              <SkillReferenceItem
                key={`${reference.type}:${reference.agent_id}:${reference.workflow_id ?? ''}:${reference.node_id ?? ''}`}
                reference={reference}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-divider-subtle px-6 py-5">
        <Button className="h-10 px-5" disabled={loading} onClick={onCancel}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button className="h-10 px-5" variant="primary" loading={loading} onClick={onConfirm}>
          {t(($) => $['skillManagement.detail.publishUpdate'])}
        </Button>
      </div>
    </div>
  )
}

function SkillReferenceItem({ reference }: { reference: SkillReferenceResponse }) {
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
        className="flex h-8 w-fit max-w-[480px] min-w-0 items-center gap-2 rounded-lg px-2 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
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
        <span className="max-w-[252px] min-w-0 truncate system-sm-regular text-text-secondary">
          {title}
        </span>
        <span
          aria-hidden
          className="i-ri-arrow-right-up-line size-4 shrink-0 text-text-quaternary"
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
      <span aria-hidden className="i-ri-arrow-right-up-line size-4 shrink-0 text-text-quaternary" />
    </>
  )

  if (reference.app_id) {
    return (
      <Link
        href={`/app/${reference.app_id}/workflow`}
        target="_blank"
        rel="noreferrer"
        className="flex h-8 w-fit max-w-[480px] min-w-0 items-center gap-2 rounded-lg px-2 outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        {workflowContent}
      </Link>
    )
  }

  return (
    <div className="flex h-8 w-fit max-w-[480px] min-w-0 items-center gap-2 rounded-lg px-2 hover:bg-state-base-hover">
      {workflowContent}
    </div>
  )
}
