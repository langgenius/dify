'use client'

import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { SkillDraftMutationCoordinator } from './mutations'
import type { TagComboboxItem } from '@/features/tag-management/tag-option'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
  createComboboxItems,
} from '@langgenius/dify-ui/combobox'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { TagManagementDialog } from '@/features/tag-management/tag-management-dialog'
import { isCreateTagOption } from '@/features/tag-management/tag-option'
import { TagSearchContentView } from '@/features/tag-management/tag-search-content'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import { invalidateSkillDetail } from './cache'
import { runSkillDraftMutation } from './mutations'

const SKILL_TAG_CREATE_OPTION_PREFIX = '\u0000skill-tag-create:'

const getSkillTagOptionId = (tag: string) => `skill-tag:${tag.trim().toLocaleLowerCase()}`

export function SkillTagsEditor({
  detail,
  draftMutationCoordinator,
  readonly,
  skillId,
}: {
  detail: SkillDetailResponse | undefined
  draftMutationCoordinator: SkillDraftMutationCoordinator
  readonly: boolean
  skillId: string
}) {
  const { t } = useTranslation(['skill'])
  const { t: tCommon } = useTranslation(['common'])
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [showTagManagement, setShowTagManagement] = useState(false)
  const [tagSearch, setTagSearch] = useState('')
  const [draftTags, setDraftTags] = useState<string[] | null>(null)
  const [isSavingTags, setIsSavingTags] = useState(false)
  const persistedTags = useMemo(() => detail?.tags ?? [], [detail?.tags])
  const tags = persistedTags
  const visibleTags = draftTags ?? tags
  const metadataMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.patch.mutationOptions({
      meta: { errorToast: false },
    }),
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
        id: getSkillTagOptionId(normalizedTag),
        name: normalizedTag,
        type: 'skill',
        binding_count: '0',
      })
    }

    for (const tag of tags) addOption(tag)
    for (const tag of tagsQuery.data?.data ?? []) addOption(tag.tag)
    for (const tag of draftTags ?? []) addOption(tag)
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
  const tagOptionById = useMemo(() => new Map(tagOptions.map((tag) => [tag.id, tag])), [tagOptions])
  const tagItems = useMemo(
    () =>
      createComboboxItems(tagOptions, {
        getValue: (tag) => tag.id,
        getLabel: (tag) => tag.name,
      }),
    [tagOptions],
  )
  const draftTagIds = useMemo(() => visibleTags.map(getSkillTagOptionId), [visibleTags])

  const saveTags = (nextTags: string[]) => {
    if (!detail || isSavingTags) return
    setIsSavingTags(true)

    void runSkillDraftMutation(draftMutationCoordinator, (expectedUpdatedAt) =>
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
      })
      .catch((error) => {
        invalidateSkillDetail(queryClient, skillId)
        toast.error(
          getErrorMessage(error) ?? t(($) => $['skillManagement.detail.updateTagsFailed']),
        )
      })
      .finally(() => {
        setDraftTags(null)
        setIsSavingTags(false)
      })
  }

  const handleOpenChange = (open: boolean) => {
    if (isSavingTags) return

    if (open) {
      setDraftTags(tags)
      setTagSearch('')
      setAddOpen(true)
      return
    }

    setAddOpen(false)
    setTagSearch('')
    if (!draftTags) return

    const draftTagSet = new Set(draftTags)
    const tagsChanged =
      tags.length !== draftTags.length || tags.some((tag) => !draftTagSet.has(tag))
    if (tagsChanged) saveTags(draftTags)
    else setDraftTags(null)
  }

  const renderTagBadge = (tag: string) => (
    <span
      key={tag}
      className="group/tag relative flex max-w-full min-w-4.5 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1.25 py-0.75 system-2xs-medium-uppercase text-text-tertiary"
    >
      <span className="min-w-0 truncate">{tag}</span>
      {!readonly && (
        <button
          type="button"
          disabled={addOpen || isSavingTags}
          aria-label={t(($) => $['skillManagement.detail.removeTag'], { tag })}
          className="flex h-3 max-w-0 shrink-0 cursor-pointer items-center justify-center overflow-hidden text-text-quaternary opacity-0 outline-hidden transition-[max-width,margin,opacity] group-hover/tag:ms-0.5 group-hover/tag:max-w-3 group-hover/tag:opacity-100 hover:text-text-secondary focus-visible:ms-0.5 focus-visible:max-w-3 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid"
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
        {visibleTags.map(renderTagBadge)}
        {!readonly && (
          <Combobox<string, true, TagComboboxItem>
            items={tagItems}
            multiple
            open={addOpen}
            onOpenChange={handleOpenChange}
            value={draftTagIds}
            onValueChange={(nextTagIds) => {
              const createOptionId = nextTagIds.find((tagId) => {
                const tag = tagOptionById.get(tagId)
                return tag ? isCreateTagOption(tag) : false
              })
              const createOption = createOptionId ? tagOptionById.get(createOptionId) : undefined
              if (createOption && isCreateTagOption(createOption)) {
                setDraftTags((currentTags) => [...(currentTags ?? tags), createOption.name])
                setTagSearch('')
                return
              }

              setDraftTags(
                nextTagIds.flatMap((tagId) => {
                  const tag = tagOptionById.get(tagId)
                  return tag && !isCreateTagOption(tag) ? [tag.name] : []
                }),
              )
            }}
            inputValue={tagSearch}
            onInputValueChange={setTagSearch}
            filter={(tag, query) =>
              tag.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
            }
          >
            <ComboboxTrigger
              disabled={!detail || isSavingTags}
              aria-label={t(($) => $['skillManagement.detail.addTag'])}
              className={cn(
                'flex h-4.5 min-w-4.5 items-center justify-center gap-0.5 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm text-start whitespace-nowrap text-text-tertiary transition-colors hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled data-disabled:hover:bg-components-input-bg-disabled data-placeholder:text-components-input-text-placeholder data-disabled:data-placeholder:text-components-input-text-disabled data-popup-open:bg-state-base-hover motion-reduce:transition-none',
                visibleTags.length === 0 && 'border-dashed px-1.25',
              )}
            >
              <span className="flex items-center justify-center gap-0.5 system-2xs-medium-uppercase">
                <span aria-hidden className="i-ri-add-line size-3 shrink-0" />
                {visibleTags.length === 0 && t(($) => $['skillManagement.detail.addTag'])}
              </span>
            </ComboboxTrigger>
            <ComboboxPortal>
              <ComboboxPositioner>
                <ComboboxPopup className="w-(--anchor-width) min-w-60 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-0 shadow-lg backdrop-blur-[5px]">
                  <TagSearchContentView
                    type="skill"
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
      <TagManagementDialog
        type="skill"
        show={showTagManagement}
        onClose={() => setShowTagManagement(false)}
      />
    </>
  )
}
