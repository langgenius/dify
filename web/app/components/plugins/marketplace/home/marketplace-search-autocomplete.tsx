'use client'

import type { MarketplacePlugin, MarketplaceTemplate } from '@dify/contracts/marketplace'
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemIndicator,
  AutocompleteItemText,
  AutocompleteList,
  AutocompletePopup,
  AutocompletePortal,
  AutocompletePositioner,
  AutocompleteStatus,
} from '@langgenius/dify-ui/autocomplete'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { renderI18nObject } from '@/i18n-config/index'
import { marketplaceQuery } from '@/service/client'
import { markMarketplaceSiteSearch } from '@/utils/marketplace-site-track'
import { getPluginIconInMarketplace } from '../utils'

export type MarketplaceSearchScope = 'all' | 'plugins' | 'templates'

export type MarketplaceSearchSelection =
  | { kind: 'plugin'; plugin: MarketplacePlugin }
  | { kind: 'template'; template: MarketplaceTemplate }

type MarketplaceSuggestion = {
  description: string
  iconUrl?: string
  id: string
  kind: 'plugin' | 'template'
  label: string
  meta: string
  selection: MarketplaceSearchSelection
}

type MarketplaceSearchAutocompleteProps = {
  category?: string
  inputName?: string
  locale: string
  onSuggestionSelect?: (selection: MarketplaceSearchSelection) => void
  onValueChange: (value: string) => void
  placeholder: string
  scope: MarketplaceSearchScope
  value: string
}

const getPluginText = (
  value: MarketplacePlugin['brief'] | MarketplacePlugin['label'],
  locale: string,
) => {
  if (typeof value === 'string') return value
  return renderI18nObject((value ?? {}) as Record<string, string>, locale)
}

const toTemplateSuggestion = (template: MarketplaceTemplate): MarketplaceSuggestion => ({
  description: template.overview,
  iconUrl: template.icon_file_key
    ? `${MARKETPLACE_API_PREFIX}/templates/${template.id}/icon`
    : undefined,
  id: `template:${template.id}`,
  kind: 'template',
  label: template.template_name,
  meta: template.publisher_handle || template.publisher_unique_handle || '',
  selection: { kind: 'template', template },
})

const toPluginSuggestion = (plugin: MarketplacePlugin, locale: string): MarketplaceSuggestion => ({
  description: getPluginText(plugin.brief, locale),
  iconUrl: getPluginIconInMarketplace(plugin),
  id: `plugin:${plugin.org}/${plugin.name}`,
  kind: 'plugin',
  label: getPluginText(plugin.label, locale) || plugin.name,
  meta: plugin.org,
  selection: { kind: 'plugin', plugin },
})

export function MarketplaceSearchAutocomplete({
  category = 'all',
  inputName,
  locale,
  onSuggestionSelect,
  onValueChange,
  placeholder,
  scope,
  value,
}: MarketplaceSearchAutocompleteProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const debouncedSearch = useDebounce(value.trim(), { wait: 300 })
  const hasQuery = Boolean(debouncedSearch)
  const searchesPlugins = scope === 'all' || scope === 'plugins'
  const searchesTemplates = scope === 'all' || scope === 'templates'
  const isBundleSearch = category === 'bundle'
  const pluginQuery = useQuery({
    ...marketplaceQuery.searchAdvanced.queryOptions({
      input: {
        params: { kind: isBundleSearch ? 'bundles' : 'plugins' },
        body: {
          page: 1,
          page_size: 5,
          query: debouncedSearch,
          sort_by: 'install_count',
          sort_order: 'DESC',
          category: category !== 'all' && !isBundleSearch ? category : '',
        },
      },
      retry: false,
    }),
    // No placeholderData here: showing the previous term's suggestions would
    // leave stale items keyboard-selectable while the new request is pending.
    enabled: hasQuery && searchesPlugins,
    staleTime: 60_000,
  })
  const templateQuery = useQuery({
    ...marketplaceQuery.templateSearch.queryOptions({
      input: {
        body: {
          page: 1,
          page_size: 5,
          query: debouncedSearch,
          sort_by: 'usage_count',
          sort_order: 'DESC',
          ...(category !== 'all' ? { categories: [category] } : {}),
        },
      },
      retry: false,
    }),
    enabled: hasQuery && searchesTemplates,
    staleTime: 60_000,
  })
  // While the edited value is still debouncing, the queries above still hold
  // the previous term's data; gate the suggestions until both agree so stale
  // options are never visible or keyboard-selectable.
  const isDebouncing = value.trim() !== debouncedSearch
  const pluginSuggestions =
    !isDebouncing && searchesPlugins
      ? (pluginQuery.data?.data.bundles ?? pluginQuery.data?.data.plugins ?? []).map((plugin) =>
          toPluginSuggestion(plugin, locale),
        )
      : []
  const templateSuggestions =
    !isDebouncing && searchesTemplates
      ? (templateQuery.data?.data?.templates ?? []).map(toTemplateSuggestion)
      : []
  const suggestions = [...templateSuggestions, ...pluginSuggestions]
  const isSearching = isDebouncing || pluginQuery.isFetching || templateQuery.isFetching
  // Keep open tied to the typing session so outside-press can dismiss during
  // debounce/fetch. Pending, empty, and error copy live inside the popup.
  const hasTypedQuery = Boolean(value.trim())
  const isPopupOpen = isOpen && hasTypedQuery
  // A failed request must not read as "nothing matched"; when every source in
  // scope errored and nothing is displayable, surface a load failure instead.
  const hasLoadError =
    !isDebouncing &&
    suggestions.length === 0 &&
    ((searchesPlugins && pluginQuery.isError) || (searchesTemplates && templateQuery.isError))
  const emptyText = hasLoadError
    ? t(($) => $['marketplace.loadError'], { ns: 'plugin' })
    : scope === 'templates'
      ? t(($) => $['newApp.noTemplateFound'], { ns: 'app' })
      : t(($) => $['marketplace.noPluginFound'], { ns: 'plugin' })

  return (
    <Autocomplete
      filter={null}
      itemToStringValue={(item) => item.label}
      items={suggestions}
      mode="list"
      name={inputName}
      onOpenChange={setIsOpen}
      onValueChange={(nextValue) => {
        onValueChange(nextValue)
        setIsOpen(Boolean(nextValue.trim()))
      }}
      open={isPopupOpen}
      openOnInputClick
      submitOnItemClick={Boolean(inputName)}
      value={value}
    >
      <AutocompleteInputGroup size="large">
        <span
          aria-hidden
          className="ml-3 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
        />
        <AutocompleteInput
          aria-label={placeholder}
          className="px-2 text-sm"
          placeholder={placeholder}
          size="large"
          type="text"
        />
        {!!value && (
          <AutocompleteClear
            aria-label={t(($) => $.clearSearch, { ns: 'plugin', label: placeholder })}
            size="large"
          />
        )}
      </AutocompleteInputGroup>
      <AutocompletePortal hidden={!isPopupOpen}>
        <AutocompletePositioner sideOffset={8}>
          <AutocompletePopup className="max-w-[420px]" aria-busy={isSearching || undefined}>
            <AutocompleteList<MarketplaceSuggestion>>
              {(item) => (
                <AutocompleteItem
                  key={item.id}
                  value={item}
                  className="items-start py-2"
                  onClick={
                    onSuggestionSelect
                      ? () => {
                          onSuggestionSelect(item.selection)
                          queueMicrotask(() => {
                            onValueChange('')
                            setIsOpen(false)
                          })
                        }
                      : undefined
                  }
                >
                  {item.iconUrl ? (
                    <img
                      alt=""
                      className="mt-0.5 size-6 shrink-0 rounded-md object-contain"
                      src={item.iconUrl}
                      onError={({ currentTarget }) => {
                        currentTarget.style.display = 'none'
                      }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        'mt-0.5 size-4 shrink-0 text-text-tertiary',
                        item.kind === 'template' ? 'i-ri-layout-grid-line' : 'i-ri-puzzle-2-line',
                      )}
                    />
                  )}
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <AutocompleteItemText className="px-0 text-text-primary">
                      {item.label}
                    </AutocompleteItemText>
                    {!!item.description && (
                      <span className="line-clamp-2 system-xs-regular text-text-tertiary">
                        {item.description}
                      </span>
                    )}
                    {!!item.meta && (
                      <span className="truncate system-xs-regular text-text-quaternary">
                        {item.meta}
                      </span>
                    )}
                  </span>
                  <AutocompleteItemIndicator />
                </AutocompleteItem>
              )}
            </AutocompleteList>
            <AutocompleteEmpty>
              {!isSearching && suggestions.length === 0 ? emptyText : null}
            </AutocompleteEmpty>
            <AutocompleteStatus>
              {isSearching ? t(($) => $.loading, { ns: 'common' }) : null}
            </AutocompleteStatus>
          </AutocompletePopup>
        </AutocompletePositioner>
      </AutocompletePortal>
    </Autocomplete>
  )
}

type MarketplaceSearchFormProps = {
  action: string
  category?: string
  className?: string
  language?: string
  locale: string
  placeholder: string
  query: string
  scope: MarketplaceSearchScope
}

export function MarketplaceSearchForm({
  action,
  category,
  className,
  language,
  locale,
  placeholder,
  query,
  scope,
}: MarketplaceSearchFormProps) {
  const [value, setValue] = useState(query)

  return (
    <form
      action={action}
      className={cn('relative shrink-0', className)}
      onSubmit={() => {
        markMarketplaceSiteSearch(value)
      }}
    >
      <MarketplaceSearchAutocomplete
        category={category}
        inputName="q"
        locale={locale}
        onValueChange={setValue}
        placeholder={placeholder}
        scope={scope}
        value={value}
      />
      {language && <input type="hidden" name="language" value={language} />}
    </form>
  )
}
