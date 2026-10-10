'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { Separator } from '@langgenius/dify-ui/separator'
import { useTranslation } from '#i18n'
import { SearchInput } from '@/app/components/base/search-input'
import { useSearchInput } from '@/app/components/base/search-input/use-search-input'
import { PluginTagsFilter } from '../plugin-tags-filter'
import { useSearchPluginText } from './atoms'
import { useMarketplaceTagsFilter } from './use-marketplace-tags-filter'

export function MarketplaceSearchInput({ className }: { className?: string }) {
  const { t } = useTranslation(['common'])
  const [value, onValueChange] = useSearchPluginText()
  const label = t(($) => $['placeholder.search'], { ns: 'common' })

  return (
    <SearchInput
      value={value}
      onValueChange={onValueChange}
      aria-label={label}
      placeholder={label}
      className={cn('h-9 rounded-[10px] [&>input]:text-sm [&>input]:leading-5', className)}
    />
  )
}

export function MarketplacePluginSearch() {
  const { t } = useTranslation(['plugin'])
  const [value, onValueChange] = useSearchPluginText()
  const { tags, onTagsChange } = useMarketplaceTagsFilter()
  const { inputProps, clear } = useSearchInput({ value, onValueChange })
  const label = t(($) => $.searchPlugins, { ns: 'plugin' })

  return (
    <InputGroup className="rounded-xl p-1.5 shadow-md [&>input]:py-1.5 [&>input]:body-md-medium">
      <InputGroupInput
        {...inputProps}
        type="search"
        name="query"
        autoComplete="off"
        enterKeyHint="search"
        aria-label={label}
        placeholder={label}
        className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
      />
      <InputGroupAddon className="ps-0 pe-2">
        <PluginTagsFilter value={tags} onValueChange={onTagsChange} variant="labeled" />
        <Separator decorative orientation="vertical" className="mx-1 h-3.5" />
      </InputGroupAddon>
      {!!inputProps.value && (
        <InputGroupAddon align="inline-end" className="ps-2 pe-1">
          <IconButton
            size="sm"
            aria-label={t(($) => $.clearSearch, { ns: 'plugin', label })}
            className="text-text-quaternary hover:bg-transparent hover:text-text-tertiary focus-visible:bg-components-input-bg-hover focus-visible:ring-inset"
            onClick={clear}
          >
            <span aria-hidden className="i-ri-close-circle-fill size-4" />
          </IconButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
