'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import { TagFilter } from '@/features/tag-management/tag-filter'
import { consoleQuery } from '@/service/console'
import { skillKeywordQueryParser, skillQueryParamNames, skillTagQueryParser } from './query-params'

function SkillTagFilter({ onOpenTagManagement }: { onOpenTagManagement: () => void }) {
  const [selectedTags, setSelectedTags] = useQueryState(
    skillQueryParamNames.tag,
    skillTagQueryParser,
  )
  const tagsQuery = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: {
        query: {
          type: 'skill',
        },
      },
    }),
  )
  const skillTags = useMemo(
    () => (tagsQuery.data ?? []).filter((tag) => tag.type === 'skill'),
    [tagsQuery.data],
  )
  const tagIdByName = useMemo(
    () => new Map(skillTags.map((tag) => [tag.name, tag.id])),
    [skillTags],
  )
  const tagNameById = useMemo(
    () => new Map(skillTags.map((tag) => [tag.id, tag.name])),
    [skillTags],
  )
  const validSelectedTags = useMemo(
    () => selectedTags.filter((tagName) => tagIdByName.has(tagName)),
    [selectedTags, tagIdByName],
  )
  const selectedTagIds = selectedTags.flatMap((tagName) => {
    const tagId = tagIdByName.get(tagName)
    return tagId ? [tagId] : []
  })

  useEffect(() => {
    if (!tagsQuery.isSuccess || validSelectedTags.length === selectedTags.length) return

    // oxlint-disable-next-line eslint-react/set-state-in-effect -- The loaded tag list is authoritative, so remove stale names from the external URL query state.
    void setSelectedTags(validSelectedTags)
  }, [selectedTags, setSelectedTags, tagsQuery.isSuccess, validSelectedTags])

  return (
    <TagFilter
      type="skill"
      value={selectedTagIds}
      onChange={(tagIds) => {
        void setSelectedTags(
          tagIds.flatMap((tagId) => {
            const tagName = tagNameById.get(tagId)
            return tagName ? [tagName] : []
          }),
        )
      }}
      onOpenTagManagement={onOpenTagManagement}
      showLeadingIcon={false}
      triggerClassName="min-w-0"
    />
  )
}

export function SkillsToolbar({
  canEdit,
  creating,
  importing,
  onCreate,
  onImport,
  onOpenTagManagement,
}: {
  canEdit: boolean
  creating: boolean
  importing: boolean
  onCreate: () => void
  onImport: () => void
  onOpenTagManagement: () => void
}) {
  const { t } = useTranslation(['skill'])
  const [keyword, setKeyword] = useQueryState(skillQueryParamNames.keyword, skillKeywordQueryParser)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <SkillTagFilter onOpenTagManagement={onOpenTagManagement} />
      <SearchInput
        aria-label={t(($) => $['skillManagement.searchLabel'])}
        className="h-8 w-50 min-w-0 shrink"
        placeholder={t(($) => $['skillManagement.searchPlaceholder'])}
        value={keyword}
        onValueChange={(value) => {
          void setKeyword(value)
        }}
      />
      <div className="ms-auto flex shrink-0 items-center gap-2">
        {canEdit && (
          <Button
            className="h-8 gap-1 px-3"
            disabled={creating}
            loading={importing}
            onClick={onImport}
          >
            <span aria-hidden className="i-ri-upload-line size-4" />
            <span className="px-0.5 system-sm-medium">{t(($) => $['skillManagement.import'])}</span>
          </Button>
        )}
        {canEdit && (
          <Button
            variant="primary"
            className="h-8 gap-0.5 px-3"
            disabled={importing}
            loading={creating}
            onClick={onCreate}
          >
            <span aria-hidden className="i-ri-add-line size-4" />
            <span className="px-0.5 system-sm-medium">{t(($) => $['skillManagement.create'])}</span>
          </Button>
        )}
      </div>
    </div>
  )
}
