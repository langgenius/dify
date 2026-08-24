'use client'

import type { PopoverContentProps } from '@langgenius/dify-ui/popover'
import type { BuiltInMetadataItem, MetadataItem } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemText,
  ComboboxList,
  ComboboxSeparator,
} from '@langgenius/dify-ui/combobox'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDatasetMetaData } from '@/service/knowledge/use-metadata'
import { getIconClassName } from '../utils/get-icon'
import { CreateContent } from './create-content'

const i18nPrefix = 'metadata.selectMetadata'

const PickerView = {
  select: 'select',
  create: 'create',
} as const

type PickerView = (typeof PickerView)[keyof typeof PickerView]

export type DatasetMetadataPickerProps = Pick<
  PopoverContentProps,
  'placement' | 'sideOffset' | 'alignOffset'
> & {
  datasetId: string
  onSelectMetadata: (metadata: MetadataItem) => void
  onCreateMetadata: (metadata: BuiltInMetadataItem) => void | Promise<void>
  onOpenMetadataManagement: () => void
}

function getMetadataLabel(metadata: MetadataItem) {
  return metadata.name
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

  const resetPickerState = () => {
    setView(PickerView.select)
    setQuery('')
  }

  const handleOpenChangeComplete = (nextOpen: boolean) => {
    if (!nextOpen) resetPickerState()
  }

  const handleStartMetadataCreation = () => {
    setView(PickerView.create)
    setQuery('')
  }

  const handleSelectMetadata = (metadata: MetadataItem | null) => {
    if (!metadata) return

    onSelectMetadata({
      id: metadata.id,
      name: metadata.name,
      type: metadata.type,
    })
  }

  const handleCreateMetadata = async (metadata: BuiltInMetadataItem) => {
    try {
      await onCreateMetadata(metadata)
      resetPickerState()
    } catch {
      // Keep the create view open so callers can surface validation feedback and the user can correct the input.
    }
  }

  const handleOpenMetadataManagement = () => {
    setOpen(false)
    onOpenMetadataManagement()
  }

  return (
    <Popover open={open} onOpenChange={setOpen} onOpenChangeComplete={handleOpenChangeComplete}>
      <PopoverTrigger
        render={
          <Button
            variant="tertiary"
            size="small"
            aria-label={t(($) => $['metadata.addMetadata'], { ns: 'dataset' })}
            className="w-full px-2 py-0"
          >
            <span className="flex min-w-0 items-center justify-center gap-1">
              <span
                className="i-ri-add-line size-3.5 shrink-0 text-components-button-tertiary-text"
                aria-hidden="true"
              />
              <span className="truncate text-components-button-tertiary-text">
                {t(($) => $['metadata.addMetadata'], { ns: 'dataset' })}
              </span>
            </span>
          </Button>
        }
      />
      <PopoverContent
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="w-[320px] bg-components-panel-bg-blur backdrop-blur-[5px]"
      >
        <PopoverTitle className="sr-only">
          {t(($) => $['metadata.addMetadata'], { ns: 'dataset' })}
        </PopoverTitle>
        {view === PickerView.select ? (
          <Combobox<MetadataItem>
            inline
            open={open}
            onOpenChange={setOpen}
            value={null}
            items={metadataItems}
            inputValue={query}
            onInputValueChange={setQuery}
            onValueChange={handleSelectMetadata}
            itemToStringLabel={getMetadataLabel}
            filter={metadataFilter}
          >
            <MetadataPickerSelectPanel
              query={query}
              onClearQuery={() => setQuery('')}
              onStartMetadataCreation={handleStartMetadataCreation}
              onOpenMetadataManagement={handleOpenMetadataManagement}
            />
          </Combobox>
        ) : (
          <CreateContent
            onSave={handleCreateMetadata}
            hasBack
            onBack={resetPickerState}
            onClose={resetPickerState}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function MetadataPickerSelectPanel({
  query,
  onClearQuery,
  onStartMetadataCreation,
  onOpenMetadataManagement,
}: {
  query: string
  onClearQuery: () => void
  onStartMetadataCreation: () => void
  onOpenMetadataManagement: () => void
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClearQuery = () => {
    onClearQuery()
    inputRef.current?.focus()
  }

  return (
    <>
      <div className="p-2 pb-1">
        <ComboboxInputGroup>
          <span
            className="ml-2 i-ri-search-line size-4 shrink-0 text-text-tertiary"
            aria-hidden="true"
          />
          <ComboboxInput
            ref={inputRef}
            aria-label={t(($) => $[`${i18nPrefix}.search`], { ns: 'dataset' })}
            placeholder={t(($) => $[`${i18nPrefix}.search`], { ns: 'dataset' })}
            className="pl-2"
          />
          {query && (
            <IconButton
              size="sm"
              aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
              className="mr-1.5 shrink-0 hover:bg-components-input-bg-hover focus-visible:bg-components-input-bg-hover"
              onClick={handleClearQuery}
              onMouseDown={(event) => event.preventDefault()}
            >
              <span className="i-ri-close-line size-4" aria-hidden="true" />
            </IconButton>
          )}
        </ComboboxInputGroup>
      </div>
      <ComboboxList<MetadataItem>>
        {(metadata) => <MetadataOption key={metadata.id} metadata={metadata} />}
      </ComboboxList>
      <ComboboxEmpty>{t(($) => $.noData, { ns: 'common' })}</ComboboxEmpty>
      <ComboboxSeparator />
      <MetadataPickerActions
        onStartMetadataCreation={onStartMetadataCreation}
        onOpenMetadataManagement={onOpenMetadataManagement}
      />
    </>
  )
}

function MetadataOption({ metadata }: { metadata: MetadataItem }) {
  const iconClassName = getIconClassName(metadata.type)

  return (
    <ComboboxItem value={metadata}>
      <ComboboxItemText className="flex items-center gap-1.5 px-0">
        <span className={cn(iconClassName, 'size-3.5 shrink-0')} aria-hidden="true" />
        <span className="min-w-0 grow truncate">{metadata.name}</span>
      </ComboboxItemText>
      <span className="shrink-0 system-xs-regular text-text-tertiary">{metadata.type}</span>
    </ComboboxItem>
  )
}

function MetadataPickerActions({
  onStartMetadataCreation,
  onOpenMetadataManagement,
}: {
  onStartMetadataCreation: () => void
  onOpenMetadataManagement: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between p-1">
      <Button
        variant="ghost"
        size="medium"
        className="min-w-0 justify-start gap-1 px-2 text-left text-text-secondary"
        onClick={onStartMetadataCreation}
      >
        <span className="i-ri-add-line size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
        <span className="truncate system-sm-medium">
          {t(($) => $[`${i18nPrefix}.newAction`], { ns: 'dataset' })}
        </span>
      </Button>
      <div className="flex h-8 shrink-0 items-center text-text-secondary">
        <div className="mx-1 h-3 w-px bg-divider-regular" />
        <Button
          variant="ghost"
          size="medium"
          className="justify-start gap-1 px-2 text-left text-text-secondary"
          onClick={onOpenMetadataManagement}
        >
          <span className="system-sm-medium">
            {t(($) => $[`${i18nPrefix}.manageAction`], { ns: 'dataset' })}
          </span>
          <span
            className="i-ri-arrow-right-up-line size-4 shrink-0 text-text-tertiary"
            aria-hidden="true"
          />
        </Button>
      </div>
    </div>
  )
}
