'use client'

import type { MarketplacePlugin, MarketplaceTemplate } from '@dify/contracts/marketplace'
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemText,
  AutocompleteList,
  AutocompletePopup,
  AutocompletePortal,
  AutocompletePositioner,
  AutocompleteSeparator,
  AutocompleteStatus,
  useAutocompleteFilteredItems,
} from '@langgenius/dify-ui/autocomplete'
import { cn } from '@langgenius/dify-ui/cn'
import { SpinnerIcon } from '@langgenius/dify-ui/spinner'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebouncedValue } from 'foxact/use-debounced-value'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { renderI18nObject } from '@/i18n/metadata'
import { marketplaceQuery } from '@/service/marketplace'
import { markMarketplaceSiteSearch } from '@/utils/marketplace-site-track'
import {
  getPluginDetailLinkInMarketplace,
  getPluginIconInMarketplace,
  getTemplateDetailLinkInMarketplace,
} from '../utils'

type MarketplaceSearchScope = 'all' | 'plugins' | 'templates'

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

type MarketplaceSuggestionGroup = {
  id: MarketplaceSuggestion['kind']
  items: MarketplaceSuggestion[]
  label: string
}

type MarketplaceSearchAutocompleteProps = {
  category?: string
  inputName?: string
  locale: string
  onSuggestionSelect?: (selection: MarketplaceSearchSelection) => { preserveQuery: boolean } | void
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

function MarketplaceSuggestionList({
  pending,
  onSelect,
}: {
  pending: boolean
  onSelect: (selection: MarketplaceSearchSelection) => void
}) {
  const groups = useAutocompleteFilteredItems<MarketplaceSuggestionGroup>()

  return (
    // The list is the scroll container. Its scroll padding matches the group label height so
    // keyboard navigation keeps the label above a group's first item in view.
    <AutocompleteList
      className={cn(
        'scroll-pt-9 transition-opacity motion-reduce:transition-none',
        pending && 'opacity-60',
      )}
    >
      {groups.map((group, groupIndex) => (
        <AutocompleteGroup key={group.id} items={group.items}>
          {groupIndex > 0 && <AutocompleteSeparator />}
          <AutocompleteGroupLabel className="px-3 pt-3 pb-2 system-xs-semibold-uppercase text-text-primary">
            {group.label}
          </AutocompleteGroupLabel>
          <AutocompleteCollection<MarketplaceSuggestion>>
            {(item) => (
              <AutocompleteItem
                key={item.id}
                value={item}
                className="items-start gap-1 py-1 pr-1 pl-3"
                onClick={() => onSelect(item.selection)}
              >
                <span className="flex shrink-0 items-start py-1">
                  {item.iconUrl ? (
                    <img
                      alt=""
                      className={cn(
                        'shrink-0 object-contain',
                        item.kind === 'template'
                          ? 'size-8 rounded-lg border-[0.5px] border-divider-regular'
                          : 'size-7 rounded-lg',
                      )}
                      src={item.iconUrl}
                      onError={({ currentTarget }) => {
                        currentTarget.style.display = 'none'
                      }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        'flex shrink-0 items-center justify-center text-text-tertiary',
                        item.kind === 'template'
                          ? 'i-ri-layout-grid-line size-8 rounded-lg border-[0.5px] border-divider-regular text-base'
                          : 'i-ri-puzzle-2-line size-7 rounded-lg text-base',
                      )}
                    />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 p-1">
                  <AutocompleteItemText className="system-md-medium text-text-primary">
                    {item.label}
                  </AutocompleteItemText>
                  {!!item.description && (
                    <span className="line-clamp-2 system-xs-regular text-text-tertiary">
                      {item.description}
                    </span>
                  )}
                  {!!item.meta && (
                    <span className="truncate pt-1 system-xs-regular text-text-tertiary">
                      {item.meta}
                    </span>
                  )}
                </span>
              </AutocompleteItem>
            )}
          </AutocompleteCollection>
        </AutocompleteGroup>
      ))}
    </AutocompleteList>
  )
}

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
  const { t } = useTranslation(['app'])
  const { t: tCommon } = useTranslation(['common'])
  const { t: tPlugin } = useTranslation(['plugin'])
  const openSuggestion = (selection: MarketplaceSearchSelection) => {
    if (onSuggestionSelect) {
      const result = onSuggestionSelect(selection)
      if (!result?.preserveQuery) onValueChange('')
      return
    }

    window.location.assign(
      selection.kind === 'plugin'
        ? getPluginDetailLinkInMarketplace(selection.plugin)
        : getTemplateDetailLinkInMarketplace(selection.template),
    )
  }
  const debouncedSearch = useDebouncedValue(value.trim(), 300)
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
    // While a query is active, the previous term's suggestions stay listed under a loading
    // status until the next term loads, so the popup does not collapse on every keystroke.
    // Clearing the input drops them.
    placeholderData: hasQuery ? keepPreviousData : undefined,
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
    placeholderData: hasQuery ? keepPreviousData : undefined,
    enabled: hasQuery && searchesTemplates,
    staleTime: 60_000,
  })
  const isDebouncing = value.trim() !== debouncedSearch
  const pluginSuggestions = searchesPlugins
    ? (pluginQuery.data?.data.bundles ?? pluginQuery.data?.data.plugins ?? []).map((plugin) =>
        toPluginSuggestion(plugin, locale),
      )
    : []
  const templateSuggestions = searchesTemplates
    ? (templateQuery.data?.data?.templates ?? []).map(toTemplateSuggestion)
    : []
  const suggestions = [...templateSuggestions, ...pluginSuggestions]
  const suggestionGroups: MarketplaceSuggestionGroup[] = [
    ...(templateSuggestions.length
      ? [
          {
            id: 'template' as const,
            items: templateSuggestions,
            label: tPlugin(($) => $['marketplace.home.templates'], { ns: 'plugin' }),
          },
        ]
      : []),
    ...(pluginSuggestions.length
      ? [
          {
            id: 'plugin' as const,
            items: pluginSuggestions,
            label: tPlugin(($) => $['marketplace.home.plugins'], { ns: 'plugin' }),
          },
        ]
      : []),
  ]
  const isFetching = pluginQuery.isFetching || templateQuery.isFetching
  const isSearching = isDebouncing || isFetching
  // A failed request must not read as "nothing matched"; when every source in
  // scope errored and nothing is displayable, surface a load failure instead.
  const hasLoadError =
    !isDebouncing &&
    suggestions.length === 0 &&
    ((searchesPlugins && pluginQuery.isError) || (searchesTemplates && templateQuery.isError))
  const emptyText = hasLoadError
    ? tPlugin(($) => $['marketplace.loadError'], { ns: 'plugin' })
    : scope === 'templates'
      ? t(($) => $['newApp.noTemplateFound'], { ns: 'app' })
      : tPlugin(($) => $['marketplace.noPluginFound'], { ns: 'plugin' })

  // Base UI owns opening on input, outside-press and Escape dismissal, and Enter: it selects the
  // highlighted item or leaves the key to the browser, which submits the form when nothing is
  // highlighted.
  return (
    <Autocomplete
      filter={null}
      itemToStringValue={(item) => item.label}
      items={suggestionGroups}
      name={inputName}
      onOpenChange={(nextOpen, details) => {
        // Base UI also opens on arrow keys; with no query there is nothing to show, so that
        // open is cancelled. Typing opens and emptying the input closes.
        if (nextOpen && details.reason !== 'input-change' && !value.trim()) details.cancel()
      }}
      onValueChange={(nextValue, details) => {
        // Choosing a suggestion opens it instead of filling the input, so its label never
        // replaces the typed query.
        if (details.reason !== 'item-press') onValueChange(nextValue)
      }}
      value={value}
    >
      <AutocompleteInputGroup size="large">
        <span
          aria-hidden
          className="i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
        />
        <AutocompleteInput
          aria-label={placeholder}
          placeholder={placeholder}
          size="large"
          type="text"
        />
        {!!value && (
          <AutocompleteClear
            aria-label={tPlugin(($) => $.clearSearch, { ns: 'plugin', label: placeholder })}
            size="large"
          />
        )}
      </AutocompleteInputGroup>
      {/* Base UI adds its own text input to the owning form, which blocks the browser's implicit
          submission, so a form field brings the submit button Enter needs. */}
      {inputName && (
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {placeholder}
        </button>
      )}
      <AutocompletePortal>
        <AutocompletePositioner sideOffset={8}>
          <AutocompletePopup
            className="max-h-[min(20rem,var(--available-height))] max-w-(--available-width) bg-components-panel-bg-blur shadow-xl backdrop-blur-sm"
            aria-busy={isSearching || undefined}
          >
            {/* The previous suggestions stay listed while the next term loads, dimmed only while a
                request is in flight so a cached result does not flicker; the loading row follows
                them so nothing on screen moves, and it is the content on the first search. */}
            <MarketplaceSuggestionList
              pending={isFetching && suggestions.length > 0}
              onSelect={openSuggestion}
            />
            <AutocompleteStatus className="flex items-center gap-2">
              {isSearching ? (
                <>
                  <SpinnerIcon />
                  {tCommon(($) => $.loading, { ns: 'common' })}
                </>
              ) : null}
            </AutocompleteStatus>
            <AutocompleteEmpty>
              {!isSearching && suggestions.length === 0 ? emptyText : null}
            </AutocompleteEmpty>
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
