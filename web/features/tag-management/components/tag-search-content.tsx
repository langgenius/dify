import type { TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { TagComboboxItem } from './tag-combobox-item'
import { Button } from '@langgenius/dify-ui/button'
import {
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxList,
  ComboboxSeparator,
} from '@langgenius/dify-ui/combobox'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useAtomValue } from 'jotai'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
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
  showTagManagement?: boolean
}

type TagSearchContentViewProps = TagSearchContentProps & {
  canManageTags: boolean
}

export const TagSearchContentView = ({
  type,
  inputValue,
  onInputValueChange,
  onOpenTagManagement,
  onClose,
  canBindOrUnbindTags = false,
  showTagManagement = true,
  canManageTags,
}: TagSearchContentViewProps) => {
  const { t } = useTranslation(['common'])
  const inputRef = useRef<HTMLInputElement>(null)
  const placeholder = t(($) => $['tag.selectorPlaceholder'], { ns: 'common' }) || ''

  const handleClearInput = () => {
    onInputValueChange('')
    inputRef.current?.focus()
  }

  return (
    <>
      <ComboboxInputGroup>
        <span aria-hidden="true" className="i-ri-search-line size-4 shrink-0 text-text-tertiary" />
        <ComboboxInput
          ref={inputRef}
          aria-label={placeholder}
          name={`tag-search-${type}`}
          placeholder={placeholder}
        />
        {inputValue && (
          <IconButton
            size="sm"
            aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
            className="shrink-0 hover:bg-components-input-bg-hover focus-visible:bg-components-input-bg-hover"
            onClick={handleClearInput}
            onMouseDown={(event) => event.preventDefault()}
          >
            <span className="i-ri-close-line size-4" aria-hidden="true" />
          </IconButton>
        )}
      </ComboboxInputGroup>
      <ComboboxList<TagComboboxItem> className="max-h-58">
        {(tag) => {
          if (isCreateTagOption(tag) && canManageTags) {
            return (
              <ComboboxItem<string> key={tag.id} value={tag.id}>
                <ComboboxItemText className="flex items-center gap-x-1 px-0">
                  <span
                    aria-hidden="true"
                    className="i-ri-add-line size-4 shrink-0 text-text-tertiary"
                  />
                  <span className="min-w-0 grow truncate px-1 system-md-regular text-text-secondary">
                    {`${t(($) => $['tag.create'], { ns: 'common' })} `}
                    <span className="system-md-medium">{`'${tag.name}'`}</span>
                  </span>
                </ComboboxItemText>
              </ComboboxItem>
            )
          }

          return (
            <ComboboxItem<string>
              key={tag.id}
              value={tag.id}
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
          <span
            className="i-custom-vender-line-financeAndECommerce-tag-01 size-6 text-text-quaternary"
            aria-hidden="true"
          />
          <div className="system-xs-regular text-text-tertiary">
            {t(($) => $['tag.noTag'], { ns: 'common' })}
          </div>
        </div>
      </ComboboxEmpty>
      {canManageTags && showTagManagement && (
        <>
          <ComboboxSeparator />
          <div className="p-1">
            <Button
              variant="ghost"
              size="medium"
              className="w-full justify-start gap-x-1 px-2 py-1.5 text-left"
              onClick={() => {
                onOpenTagManagement?.()
                onClose?.()
              }}
            >
              <span
                className="i-custom-vender-line-financeAndECommerce-tag-01 size-4 text-text-tertiary"
                aria-hidden="true"
              />
              <span className="min-w-0 grow truncate px-1 system-md-regular text-text-secondary">
                {t(($) => $['tag.manageTags'], { ns: 'common' })}
              </span>
            </Button>
          </div>
        </>
      )}
    </>
  )
}

export const TagSearchContent = (props: TagSearchContentProps) => {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageTags = hasPermission(
    workspacePermissionKeys,
    getTagManagePermissionKey(props.type),
  )

  return <TagSearchContentView {...props} canManageTags={canManageTags} />
}
