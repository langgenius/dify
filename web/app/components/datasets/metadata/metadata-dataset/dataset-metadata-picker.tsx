'use client'

import type { ComboboxRootChangeEventDetails, Placement } from '@langgenius/dify-ui/combobox'
import type { BuiltInMetadataItem, MetadataItem } from '../types'
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
import { useDatasetMetaData } from '@/service/knowledge/use-metadata'
import { getIconClassName } from '../utils/get-icon'
import { CreateContent } from './create-content'

const i18nPrefix = 'metadata.selectMetadata'

const PickerView = {
  select: 'select',
  create: 'create',
} as const

type PickerView = typeof PickerView[keyof typeof PickerView]

export type DatasetMetadataPickerProps = {
  datasetId: string
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  onSelectMetadata: (metadata: MetadataItem) => void
  onCreateMetadata: (metadata: BuiltInMetadataItem) => void | Promise<void>
  onOpenMetadataManagement: () => void
}

function getMetadataLabel(metadata: MetadataItem) {
  return metadata.name
}

function getMetadataValue(metadata: MetadataItem) {
  return metadata.id
}

function isSameMetadata(item: MetadataItem, value: MetadataItem) {
  return item.id === value.id
}

function metadataFilter(metadata: MetadataItem, query: string) {
  return metadata.name.toLowerCase().includes(query.toLowerCase())
}

export function DatasetMetadataPicker({
  datasetId,
  placement = 'left-start',
  sideOffset = -38,
  alignOffset = 4,
  onSelectMetadata,
  onCreateMetadata,
  onOpenMetadataManagement,
}: DatasetMetadataPickerProps) {
  const { t } = useTranslation()
  const { data: datasetMetaData } = useDatasetMetaData(datasetId)
  const metadataItems = datasetMetaData?.doc_metadata ?? []
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<PickerView>(PickerView.select)
  const [query, setQuery] = useState('')

  const resetPicker = () => {
    setView(PickerView.select)
    setQuery('')
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen)
      resetPicker()
  }

  const handleInputValueChange = (inputValue: string, details: ComboboxRootChangeEventDetails) => {
    if (details.reason !== 'item-press')
      setQuery(inputValue)
  }

  const handleMetadataChange = (metadata: MetadataItem | null) => {
    if (!metadata)
      return

    onSelectMetadata({
      id: metadata.id,
      name: metadata.name,
      type: metadata.type,
    })
    setOpen(false)
    resetPicker()
  }

  const handleCreateMetadata = async (metadata: BuiltInMetadataItem) => {
    try {
      await onCreateMetadata(metadata)
      resetPicker()
    }
    catch {
      // Keep the create view open so callers can surface validation feedback and the user can correct the input.
    }
  }

  const handleOpenManagement = () => {
    setOpen(false)
    resetPicker()
    onOpenMetadataManagement()
  }

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger
        render={(
          <button
            type="button"
            aria-label={t('metadata.addMetadata', { ns: 'dataset' })}
            aria-expanded={open}
            className="flex h-6 w-full cursor-pointer items-center justify-center rounded-md border-0 bg-components-button-tertiary-bg px-2 py-0 text-xs font-medium text-components-button-tertiary-text hover:bg-components-button-tertiary-bg-hover focus-visible:bg-components-button-tertiary-bg-hover"
          >
            <span className="flex min-w-0 items-center justify-center gap-1">
              <span className="i-ri-add-line size-3.5 shrink-0 text-components-button-tertiary-text" aria-hidden="true" />
              <span className="truncate text-components-button-tertiary-text">{t('metadata.addMetadata', { ns: 'dataset' })}</span>
            </span>
          </button>
        )}
      />
      <PopoverContent
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        popupClassName="w-[320px] bg-components-panel-bg-blur backdrop-blur-[5px]"
      >
        {view === PickerView.select
          ? (
              <Combobox<MetadataItem>
                value={null}
                items={metadataItems}
                inputValue={query}
                onInputValueChange={handleInputValueChange}
                onValueChange={handleMetadataChange}
                itemToStringLabel={getMetadataLabel}
                itemToStringValue={getMetadataValue}
                isItemEqualToValue={isSameMetadata}
                filter={metadataFilter}
              >
                <MetadataPickerSelectPanel
                  query={query}
                  onNewMetadata={() => {
                    setView(PickerView.create)
                    setQuery('')
                  }}
                  onOpenMetadataManagement={handleOpenManagement}
                />
              </Combobox>
            )
          : (
              <CreateContent
                onSave={handleCreateMetadata}
                hasBack
                onBack={resetPicker}
                onClose={resetPicker}
              />
            )}
      </PopoverContent>
    </Popover>
  )
}

function MetadataPickerSelectPanel({
  query,
  onNewMetadata,
  onOpenMetadataManagement,
}: {
  query: string
  onNewMetadata: () => void
  onOpenMetadataManagement: () => void
}) {
  const { t } = useTranslation()

  return (
    <>
      <div className="p-2 pb-1">
        <ComboboxInputGroup>
          <span className="ml-2 i-ri-search-line size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <ComboboxInput
            aria-label={t(`${i18nPrefix}.search`, { ns: 'dataset' })}
            placeholder={t(`${i18nPrefix}.search`, { ns: 'dataset' })}
            className="pl-2"
          />
          {query && (
            <ComboboxClear
              aria-label={t('operation.clear', { ns: 'common' })}
            />
          )}
        </ComboboxInputGroup>
      </div>
      <ComboboxList>
        {(metadata: MetadataItem) => (
          <MetadataOption key={metadata.id} metadata={metadata} />
        )}
      </ComboboxList>
      <ComboboxEmpty>
        {t('noData', { ns: 'common' })}
      </ComboboxEmpty>
      <ComboboxSeparator />
      <MetadataPickerActions
        onNewMetadata={onNewMetadata}
        onOpenMetadataManagement={onOpenMetadataManagement}
      />
    </>
  )
}

function MetadataOption({
  metadata,
}: {
  metadata: MetadataItem
}) {
  const iconClassName = getIconClassName(metadata.type)

  return (
    <ComboboxItem value={metadata}>
      <ComboboxItemText className="flex items-center gap-1.5 px-0">
        <span className={cn(iconClassName, 'size-3.5 shrink-0')} aria-hidden="true" />
        <span className="min-w-0 grow truncate">{metadata.name}</span>
      </ComboboxItemText>
      <span className="shrink-0 system-xs-regular text-text-tertiary">
        {metadata.type}
      </span>
    </ComboboxItem>
  )
}

function MetadataPickerActions({
  onNewMetadata,
  onOpenMetadataManagement,
}: {
  onNewMetadata: () => void
  onOpenMetadataManagement: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between p-1">
      <button
        type="button"
        className={cn(
          'flex h-8 min-w-0 cursor-pointer items-center gap-1 rounded-lg border-none bg-transparent px-2 text-left text-text-secondary outline-hidden',
          'hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active',
        )}
        onClick={onNewMetadata}
      >
        <span className="i-ri-add-line size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
        <span className="truncate system-sm-medium">{t(`${i18nPrefix}.newAction`, { ns: 'dataset' })}</span>
      </button>
      <div className="flex h-8 shrink-0 items-center text-text-secondary">
        <div className="mx-1 h-3 w-px bg-divider-regular" />
        <button
          type="button"
          className={cn(
            'flex h-8 cursor-pointer items-center gap-1 rounded-lg border-none bg-transparent px-2 text-left text-text-secondary outline-hidden',
            'hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active',
          )}
          onClick={onOpenMetadataManagement}
        >
          <span className="system-sm-medium">{t(`${i18nPrefix}.manageAction`, { ns: 'dataset' })}</span>
          <span className="i-ri-arrow-right-up-line size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
