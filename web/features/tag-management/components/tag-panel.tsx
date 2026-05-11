import type { TagComboboxItem } from './tag-combobox-item'
import type { TagType } from '@/contract/console/tags'
import { ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxItemIndicator, ComboboxItemText, ComboboxList, ComboboxSeparator, useComboboxFilteredItems } from '@langgenius/dify-ui/combobox'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { isCreateTagOption } from './tag-combobox-item'

type TagPanelProps = {
  type: TagType
  inputValue: string
  onInputValueChange: (value: string) => void
  onOpenTagManagement?: () => void
  onClose?: () => void
}

export const TagPanel = ({
  type,
  inputValue,
  onInputValueChange,
  onOpenTagManagement,
  onClose,
}: TagPanelProps) => {
  const { t } = useTranslation()
  const filteredItems = useComboboxFilteredItems<TagComboboxItem>()
  const realItemCount = filteredItems.filter(tag => !isCreateTagOption(tag)).length
  const hasCreateOption = filteredItems.some(isCreateTagOption)
  const placeholder = t('tag.selectorPlaceholder', { ns: 'common' }) || ''

  return (
    <div className="relative w-full">
      <div className="p-2 pb-1">
        <ComboboxInputGroup className="border-divider-subtle bg-components-input-bg-normal">
          <span aria-hidden="true" className="ml-2 i-ri-search-line h-4 w-4 shrink-0 text-text-tertiary" />
          <ComboboxInput
            aria-label={placeholder}
            name={`tag-search-${type}`}
            placeholder={placeholder}
            className="pl-2"
          />
          {inputValue && (
            <button
              type="button"
              aria-label={t('operation.clear', { ns: 'common' })}
              className="mr-1.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-components-input-bg-hover hover:text-text-secondary focus-visible:bg-components-input-bg-hover focus-visible:text-text-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:ring-inset"
              onClick={() => onInputValueChange('')}
              onPointerDown={event => event.preventDefault()}
            >
              <span className="i-ri-close-line size-4" aria-hidden="true" />
            </button>
          )}
        </ComboboxInputGroup>
      </div>
      {filteredItems.length > 0 && (
        <ComboboxList className="max-h-58">
          {(tag: TagComboboxItem) => {
            if (isCreateTagOption(tag)) {
              return (
                <Fragment key={tag.id}>
                  <ComboboxItem
                    value={tag}
                  >
                    <ComboboxItemText className="flex items-center gap-x-1 px-0">
                      <span aria-hidden="true" className="i-ri-add-line h-4 w-4 shrink-0 text-text-tertiary" />
                      <span className="min-w-0 grow truncate px-1 system-md-regular text-text-secondary">
                        {`${t('tag.create', { ns: 'common' })} `}
                        <span className="system-md-medium">{`'${tag.name}'`}</span>
                      </span>
                    </ComboboxItemText>
                  </ComboboxItem>
                  {realItemCount > 0 && <ComboboxSeparator />}
                </Fragment>
              )
            }

            return (
              <ComboboxItem key={tag.id} value={tag}>
                <ComboboxItemText title={tag.name}>{tag.name}</ComboboxItemText>
                <ComboboxItemIndicator />
              </ComboboxItem>
            )
          }}
        </ComboboxList>
      )}
      {!hasCreateOption && realItemCount === 0 && (
        <div className="p-1">
          <div className="flex flex-col items-center gap-y-1 p-3">
            <span aria-hidden="true" className="i-ri-price-tag-3-line h-6 w-6 text-text-quaternary" />
            <div className="system-xs-regular text-text-tertiary">{t('tag.noTag', { ns: 'common' })}</div>
          </div>
        </div>
      )}
      <ComboboxSeparator />
      <div className="p-1">
        <button
          type="button"
          className="flex w-full cursor-pointer touch-manipulation items-center gap-x-1 rounded-lg px-2 py-1.5 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active"
          onClick={() => {
            onOpenTagManagement?.()
            onClose?.()
          }}
        >
          <span aria-hidden="true" className="i-ri-price-tag-3-line h-4 w-4 text-text-tertiary" />
          <span className="min-w-0 grow truncate px-1 system-md-regular text-text-secondary">
            {t('tag.manageTags', { ns: 'common' })}
          </span>
        </button>
      </div>
    </div>
  )
}
