'use client'

import { useTranslation } from '#i18n'
import { useTags } from '@/app/components/plugins/hooks'
import { CompactTagFilterTrigger } from '@/features/tag-management/compact-tag-filter-trigger'
import { TagFilterPopover } from '@/features/tag-management/tag-filter-popover'
import LabeledTrigger from './labeled-trigger'

type PluginTagsFilterProps = {
  value: string[]
  onValueChange: (tags: string[]) => void
  variant?: 'compact' | 'labeled'
}
export function PluginTagsFilter({
  value,
  onValueChange,
  variant = 'compact',
}: PluginTagsFilterProps) {
  const { t } = useTranslation(['pluginTags'])
  const { tags, tagsMap } = useTags()
  const allTags = t(($) => $.allTags, { ns: 'pluginTags' })
  const selectedLabels = value.flatMap((id) => tagsMap[id]?.label ?? [])
  const label = selectedLabels.join(', ') || allTags
  return (
    <TagFilterPopover
      options={tags}
      value={value}
      onValueChange={onValueChange}
      label={allTags}
      searchLabel={t(($) => $.searchTags, { ns: 'pluginTags' })}
    >
      {variant === 'labeled' ? (
        <LabeledTrigger tags={value} tagsMap={tagsMap} onTagsChange={onValueChange} />
      ) : (
        <CompactTagFilterTrigger
          selectedLabels={selectedLabels}
          selectedCount={value.length}
          label={label}
          clearLabel={t(($) => $.clearSelectedTags, { ns: 'pluginTags', tags: label })}
          onClear={() => onValueChange([])}
        />
      )}
    </TagFilterPopover>
  )
}
