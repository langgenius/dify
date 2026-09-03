'use client'

import type { ComboboxChangeEventDetails } from '@langgenius/dify-ui/combobox'
import type { DocumentMetadataField, DocumentMetadataType } from './editor-model'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxClear,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemText,
  ComboboxList,
  ComboboxSeparator,
} from '@langgenius/dify-ui/combobox'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DocumentMetadataCreateForm } from './create-form'

const metadataTypeIcon = {
  number: 'i-ri-hashtag',
  string: 'i-ri-text-snippet',
  time: 'i-ri-time-line',
} satisfies Record<DocumentMetadataType, string>

export function DocumentMetadataPicker({
  allowedExistingName,
  creating,
  error,
  fields,
  loading,
  onCreate,
  onManage,
  onRetry,
  onSelect,
}: {
  allowedExistingName?: string
  creating: boolean
  error: boolean
  fields: DocumentMetadataField[]
  loading: boolean
  onCreate: (name: string, type: DocumentMetadataType) => Promise<void>
  onManage: () => void
  onRetry: () => void
  onSelect: (field: DocumentMetadataField) => void
}) {
  const { t } = useTranslation('knowledgeSpace')
  const { t: tCommon } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'create' | 'select'>('select')
  const [query, setQuery] = useState('')

  const reset = () => {
    setView('select')
    setQuery('')
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) reset()
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-expanded={open}
            aria-label={t(($) => $['metadata.addMetadata'], { ns: 'dataset' })}
            className="flex h-6 w-full cursor-pointer items-center justify-center rounded-md border-0 bg-components-button-tertiary-bg px-2 text-components-button-tertiary-text hover:bg-components-button-tertiary-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          >
            <span aria-hidden className="mr-1 i-ri-add-line size-3.5" />
            <span className="truncate system-xs-medium">
              {t(($) => $['metadata.addMetadata'], { ns: 'dataset' })}
            </span>
          </button>
        }
      />
      <PopoverContent
        alignOffset={4}
        placement="left-start"
        className="w-[320px] bg-components-panel-bg-blur backdrop-blur-[5px]"
        sideOffset={-38}
      >
        {view === 'select' ? (
          <Combobox<DocumentMetadataField>
            filter={(field, input) => field.name.toLowerCase().includes(input.toLowerCase())}
            inputValue={query}
            isItemEqualToValue={(field, value) => field.name === value.name}
            items={fields}
            itemToStringLabel={(field) => field.name}
            itemToStringValue={(field) => field.name}
            onInputValueChange={(value, details: ComboboxChangeEventDetails) => {
              if (details.reason !== 'item-press') setQuery(value)
            }}
            onValueChange={(field) => {
              if (!field) return
              onSelect(field)
              setOpen(false)
              reset()
            }}
            value={null}
          >
            <div className="p-2 pb-1">
              <ComboboxInputGroup>
                <span aria-hidden className="ml-2 i-ri-search-line size-4 text-text-tertiary" />
                <ComboboxInput
                  aria-label={t(($) => $['metadata.selectMetadata.search'], { ns: 'dataset' })}
                  className="pl-2"
                  placeholder={t(($) => $['metadata.selectMetadata.search'], { ns: 'dataset' })}
                />
                {query && <ComboboxClear aria-label={tCommon(($) => $['operation.clear'])} />}
              </ComboboxInputGroup>
            </div>
            {!loading && !error && (
              <ComboboxList<DocumentMetadataField>>
                {(field) => (
                  <ComboboxItem key={field.name} value={field}>
                    <ComboboxItemText className="flex min-w-0 items-center gap-1.5 px-0">
                      <span
                        aria-hidden
                        className={cn(metadataTypeIcon[field.type], 'size-3.5 shrink-0')}
                      />
                      <span className="min-w-0 grow truncate">{field.name}</span>
                    </ComboboxItemText>
                    <span className="shrink-0 system-xs-regular text-text-tertiary">
                      {field.type}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            )}
            {loading && (
              <div className="flex h-20 items-center justify-center gap-2 system-xs-regular text-text-tertiary">
                <span aria-hidden className="i-ri-loader-2-line size-4 animate-spin" />
                {tCommon(($) => $.loading)}
              </div>
            )}
            {error && !loading && (
              <div className="flex h-20 flex-col items-center justify-center gap-1 px-3 text-center">
                <span className="system-xs-regular text-text-tertiary">
                  {t(($) => $.documentLoadErrorDescription)}
                </span>
                <Button onClick={onRetry} size="small" variant="ghost">
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              </div>
            )}
            {!loading && !error && <ComboboxEmpty>{tCommon(($) => $.noData)}</ComboboxEmpty>}
            <ComboboxSeparator />
            <div className="flex items-center justify-between p-1">
              <button
                type="button"
                disabled={loading || error}
                className="flex h-8 min-w-0 cursor-pointer items-center gap-1 rounded-lg border-0 bg-transparent px-2 text-text-secondary hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent"
                onClick={() => {
                  setView('create')
                  setQuery('')
                }}
              >
                <span aria-hidden className="i-ri-add-line size-4 text-text-tertiary" />
                <span className="truncate system-sm-medium">
                  {t(($) => $['metadata.selectMetadata.newAction'], { ns: 'dataset' })}
                </span>
              </button>
              <div className="flex h-8 shrink-0 items-center">
                <div className="mx-1 h-3 w-px bg-divider-regular" />
                <button
                  type="button"
                  className="flex h-8 cursor-pointer items-center gap-1 rounded-lg border-0 bg-transparent px-2 text-text-secondary hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                  onClick={() => {
                    setOpen(false)
                    reset()
                    onManage()
                  }}
                >
                  <span className="system-sm-medium">
                    {t(($) => $['metadata.selectMetadata.manageAction'], { ns: 'dataset' })}
                  </span>
                  <span
                    aria-hidden
                    className="i-ri-arrow-right-up-line size-4 text-text-tertiary"
                  />
                </button>
              </div>
            </div>
          </Combobox>
        ) : (
          <DocumentMetadataCreateForm
            allowedExistingName={allowedExistingName}
            fields={fields}
            pending={creating}
            onClose={reset}
            onCreate={async (name, type) => {
              await onCreate(name, type)
              return true
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
