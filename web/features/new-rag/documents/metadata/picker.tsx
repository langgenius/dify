'use client'

import type { PopoverActions } from '@langgenius/dify-ui/popover'
import type { DocumentMetadataField, DocumentMetadataType } from './editor-model'
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
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DocumentMetadataCreateForm } from './create-form'

const metadataTypeIcon = {
  number: 'i-ri-hashtag',
  string: 'i-ri-text-snippet',
  time: 'i-ri-time-line',
} satisfies Record<DocumentMetadataType, string>

type DocumentMetadataPickerProps = {
  allowedExistingName?: string
  creating: boolean
  disabled?: boolean
  error: boolean
  fields: DocumentMetadataField[]
  loading: boolean
  onCreate: (name: string, type: DocumentMetadataType) => Promise<void>
  onManage: () => void
  onRetry: () => void
  onSelect: (field: DocumentMetadataField) => void
}

export function DocumentMetadataPicker({
  allowedExistingName,
  creating,
  disabled = false,
  error,
  fields,
  loading,
  onCreate,
  onManage,
  onRetry,
  onSelect,
}: DocumentMetadataPickerProps) {
  const { t } = useTranslation(['knowledgeCitation', 'dataset'])
  const { t: tCommon } = useTranslation(['common'])
  const popoverActionsRef = useRef<PopoverActions>(null)
  const [view, setView] = useState<'create' | 'select'>('select')

  return (
    <Popover
      actionsRef={popoverActionsRef}
      onOpenChangeComplete={(open) => {
        if (!open) setView('select')
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="tertiary" size="small" className="w-full" disabled={disabled}>
            <span aria-hidden className="i-ri-add-line size-3.5" />
            <span className="truncate">
              {t(($) => $['metadata.addMetadata'], { ns: 'dataset' })}
            </span>
          </Button>
        }
      />
      <PopoverContent
        alignOffset={4}
        side="left"
        align="start"
        className="w-80 max-w-(--available-width) bg-components-panel-bg-blur backdrop-blur-[5px]"
        sideOffset={-38}
      >
        <PopoverTitle className="sr-only">
          {view === 'select'
            ? t(($) => $['metadata.addMetadata'], { ns: 'dataset' })
            : t(($) => $['metadata.createMetadata.title'], { ns: 'dataset' })}
        </PopoverTitle>
        {view === 'select' ? (
          <Combobox<DocumentMetadataField>
            inline
            open
            items={fields}
            itemToStringLabel={(field) => field.name}
            onValueChange={(field) => {
              if (!field) return
              onSelect(field)
              popoverActionsRef.current?.close()
            }}
            value={null}
          >
            <div className="p-2 pb-1">
              <ComboboxInputGroup>
                <span aria-hidden className="i-ri-search-line size-4 shrink-0 text-text-tertiary" />
                <ComboboxInput
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- Returning from the create view replaces the focused control in an open popover.
                  autoFocus
                  aria-label={t(($) => $['metadata.selectMetadata.search'], { ns: 'dataset' })}
                  placeholder={t(($) => $['metadata.selectMetadata.search'], { ns: 'dataset' })}
                />
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
                      {t(($) => $[`metadata.type.${field.type}`], { ns: 'dataset' })}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            )}
            {loading && (
              <div
                role="status"
                className="flex h-20 items-center justify-center gap-2 system-xs-regular text-text-tertiary"
              >
                <span aria-hidden className="i-ri-loader-2-line size-4 animate-spin" />
                {tCommon(($) => $.loading)}
              </div>
            )}
            {error && !loading && (
              <div className="flex h-20 flex-col items-center justify-center gap-1 px-3 text-center">
                <span role="status" className="system-xs-regular text-text-tertiary">
                  {t(($) => $.documentLoadErrorDescription, { ns: 'knowledgeCitation' })}
                </span>
                <Button onClick={onRetry} size="small" variant="ghost">
                  {tCommon(($) => $['operation.retry'])}
                </Button>
              </div>
            )}
            {!loading && !error && <ComboboxEmpty>{tCommon(($) => $.noData)}</ComboboxEmpty>}
            <ComboboxSeparator />
            <div className="flex items-center justify-between p-1">
              <Button
                variant="ghost"
                className="min-w-0 px-2"
                disabled={loading || error}
                onClick={() => {
                  setView('create')
                }}
              >
                <span aria-hidden className="i-ri-add-line size-4 text-text-tertiary" />
                <span className="truncate">
                  {t(($) => $['metadata.selectMetadata.newAction'], { ns: 'dataset' })}
                </span>
              </Button>
              <div className="flex h-8 shrink-0 items-center">
                <div className="mx-1 h-3 w-px bg-divider-regular" />
                <Button
                  variant="ghost"
                  className="px-2"
                  onClick={() => {
                    popoverActionsRef.current?.close()
                    onManage()
                  }}
                >
                  {t(($) => $['metadata.selectMetadata.manageAction'], { ns: 'dataset' })}
                  <span
                    aria-hidden
                    className="i-ri-arrow-right-up-line size-4 text-text-tertiary"
                  />
                </Button>
              </div>
            </div>
          </Combobox>
        ) : (
          <DocumentMetadataCreateForm
            allowedExistingName={allowedExistingName}
            fields={fields}
            pending={creating}
            onClose={() => setView('select')}
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
