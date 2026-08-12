'use client'

import type { MarketplacePlugin, MarketplaceTemplate } from '@dify/contracts/marketplace'
import {
  Autocomplete,
  AutocompleteClear,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemIndicator,
  AutocompleteItemText,
  AutocompleteList,
  AutocompleteStatus,
} from '@langgenius/dify-ui/autocomplete'
import { cn } from '@langgenius/dify-ui/cn'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { renderI18nObject } from '@/i18n-config/index'
import { marketplaceQuery } from '@/service/client'

export type MarketplaceSearchScope = 'all' | 'plugins' | 'templates'

export type MarketplaceSearchSelection =
  | { kind: 'plugin'; plugin: MarketplacePlugin }
  | { kind: 'template'; template: MarketplaceTemplate }

type MarketplaceSuggestion = {
  description: string
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
  onValueChange: (value: string) => void
  onSuggestionSelect?: (selection: MarketplaceSearchSelection) => void
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
  id: `template:${template.id}`,
  kind: 'template',
  label: template.template_name,
  meta: template.publisher_handle || template.publisher_unique_handle || '',
  selection: { kind: 'template', template },
})

const toPluginSuggestion = (plugin: MarketplacePlugin, locale: string): MarketplaceSuggestion => ({
  description: getPluginText(plugin.brief, locale),
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
  onValueChange,
  onSuggestionSelect,
  placeholder,
  scope,
  value,
}: MarketplaceSearchAutocompleteProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const translate = t as (key: string, options?: Record<string, unknown>) => string
  const debouncedSearch = useDebounce(value.trim(), { wait: 300 })
  const hasQuery = Boolean(debouncedSearch)
  const showDropdown = isOpen && hasQuery
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
    enabled: hasQuery && searchesPlugins,
    placeholderData: keepPreviousData,
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
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
  const pluginSuggestions = searchesPlugins
    ? (pluginQuery.data?.data.bundles ?? pluginQuery.data?.data.plugins ?? []).map((plugin) =>
        toPluginSuggestion(plugin, locale),
      )
    : []
  const templateSuggestions = searchesTemplates
    ? (templateQuery.data?.data?.templates ?? []).map(toTemplateSuggestion)
    : []
  const suggestions = [...templateSuggestions, ...pluginSuggestions]
  const isSearching = pluginQuery.isFetching || templateQuery.isFetching
  const emptyText =
    scope === 'templates'
      ? translate('newApp.noTemplateFound', { ns: 'app' })
      : translate('marketplace.noPluginFound', { ns: 'plugin' })

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
      open={showDropdown}
      openOnInputClick
      submitOnItemClick={Boolean(inputName)}
      value={value}
    >
      <AutocompleteInputGroup
        size="large"
        className="border-[0.5px] border-components-input-border-active"
      >
        <span
          aria-hidden
          className="ml-3 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
        />
        <AutocompleteInput
          aria-label={placeholder}
          className="px-2 text-sm"
          placeholder={placeholder}
          size="large"
        />
        {!!value && (
          <AutocompleteClear
            aria-label={translate('clearSearch', { ns: 'plugin', label: placeholder })}
            size="large"
          />
        )}
      </AutocompleteInputGroup>
      <AutocompleteContent
        sideOffset={8}
        portalProps={{ hidden: !showDropdown }}
        popupClassName="max-w-[420px]"
        popupProps={{ 'aria-busy': isSearching || undefined }}
      >
        {isSearching && suggestions.length === 0 && (
          <AutocompleteStatus>
            {translate('gotoAnything.searching', { ns: 'app' })}
          </AutocompleteStatus>
        )}
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
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 size-4 shrink-0 text-text-tertiary',
                  item.kind === 'template' ? 'i-ri-layout-grid-line' : 'i-ri-puzzle-2-line',
                )}
              />
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
        {!isSearching && <AutocompleteEmpty>{emptyText}</AutocompleteEmpty>}
      </AutocompleteContent>
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
    <form action={action} className={cn('relative shrink-0', className)}>
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
