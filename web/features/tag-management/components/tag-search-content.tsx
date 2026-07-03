import type { TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { TagComboboxItem } from './tag-combobox-item'
import { ComboboxEmpty, ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxItemIndicator, ComboboxItemText, ComboboxList, ComboboxSeparator, useComboboxFilteredItems } from '@langgenius/dify-ui/combobox'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { hasPermission } from '@/utils/permission'
import { getTagManagePermissionKey } from '../utils'
import { isCreateTagOption } from './tag-combobox-item'

type TagSearchContentProps = {
  type: TagType
  inputValue: string
  onInputValueChange: (value: string) => void
  onOpenTagManagement?: () => void
  onClose?: () => void
  canBindOrUnbindTags?: boolean
}

export const TagSearchContent = ({
  type,
  inputValue,
  onInputValueChange,
  onOpenTagManagement,
  onClose,
  canBindOrUnbindTags = false,
}: TagSearchContentProps) => {
  const { t } = useTranslation()
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const canManageTags = hasPermission(workspacePermissionKeys, getTagManagePermissionKey(type))
  const filteredItems = useComboboxFilteredItems<TagComboboxItem>()
  const realItemCount = filteredItems.filter(tag => !isCreateTagOption(tag)).length
  const placeholder = t('tag.selectorPlaceholder', { ns: 'common' }) || ''

  return (
    <div className="relative w-full">
      <div className="p-2 pb-1">
        <ComboboxInputGroup className="border-divider-subtle bg-components-input-bg-normal">
          <span aria-hidden="true" className="ml-2 i-ri-search-line size-4 shrink-0 text-text-tertiary" />
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
              className="mr-1.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-components-input-bg-hover hover:text-text-secondary focus-visible:bg-components-input-bg-hover focus-visible:text-text-secondary focus-visible:inset-ring-1 focus-visible:inset-ring-components-input-border-active"
              onClick={() => onInputValueChange('')}
              onPointerDown={event => event.preventDefault()}
            >
              <span className="i-ri-close-line size-4" aria-hidden="true" />
            </button>
          )}
        </ComboboxInputGroup>
      </div>
      <ComboboxList className="max-h-58">
        {(tag: TagComboboxItem) => {
          if (isCreateTagOption(tag) && canManageTags) {
            return (
              <Fragment key={tag.id}>
                <ComboboxItem
                  value={tag}
                >
                  <ComboboxItemText className="flex items-center gap-x-1 px-0">
                    <span aria-hidden="true" className="i-ri-add-line size-4 shrink-0 text-text-tertiary" />
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
            <ComboboxItem
              key={tag.id}
              value={tag}
              disabled={!canBindOrUnbindTags && !canManageTags}
            >
              <ComboboxItemText title={tag.name}>{tag.name}</ComboboxItemText>
              <ComboboxItemIndicator />
            </ComboboxItem>
          )
        }}
      </ComboboxList>
      <ComboboxEmpty className="p-1">
        <div className="flex flex-col items-center gap-y-1 p-3">
          <span className="i-custom-vender-line-financeAndECommerce-tag-01 size-6 text-text-quaternary" aria-hidden="true" />
          <div className="system-xs-regular text-text-tertiary">{t('tag.noTag', { ns: 'common' })}</div>
        </div>
      </ComboboxEmpty>
      {canManageTags && (
        <>
          <ComboboxSeparator />
          <div className="p-1">
            <button
              type="button"
              className="flex w-full cursor-pointer touch-manipulation items-center gap-x-1 rounded-lg px-2 py-1.5 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={() => {
                onOpenTagManagement?.()
                onClose?.()
              }}
            >
              <span className="i-custom-vender-line-financeAndECommerce-tag-01 size-4 text-text-tertiary" aria-hidden="true" />
              <span className="min-w-0 grow truncate px-1 system-md-regular text-text-secondary">
                {t('tag.manageTags', { ns: 'common' })}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
