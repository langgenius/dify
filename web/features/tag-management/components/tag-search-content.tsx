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
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'
import { getTagManagePermissionKey } from '../utils'
import { isCreateTagOption } from './tag-combobox-item'

type TagSearchContentProps = {
  type: TagType
  onOpenTagManagement?: () => void
  onClose?: () => void
  canBindOrUnbindTags?: boolean
  requiresTargetEditPermission?: boolean
  showTagManagement?: boolean
}

type TagSearchContentViewProps = TagSearchContentProps & {
  canManageTags: boolean
}

export const TagSearchContentView = ({
  type,
  onOpenTagManagement,
  onClose,
  canBindOrUnbindTags = false,
  requiresTargetEditPermission = false,
  showTagManagement = true,
  canManageTags,
}: TagSearchContentViewProps) => {
  const { t } = useTranslation(['common'])
  const canChangeBindings = requiresTargetEditPermission
    ? canBindOrUnbindTags
    : canBindOrUnbindTags || canManageTags
  const placeholder = t(($) => $['tag.selectorPlaceholder'], { ns: 'common' }) || ''

  return (
    <>
      <ComboboxInputGroup>
        <span aria-hidden="true" className="i-ri-search-line size-4 shrink-0 text-text-tertiary" />
        <ComboboxInput
          aria-label={placeholder}
          name={`tag-search-${type}`}
          placeholder={placeholder}
        />
      </ComboboxInputGroup>
      <ComboboxList<TagComboboxItem> className="max-h-58">
        {(tag) => {
          if (isCreateTagOption(tag) && canManageTags) {
            return (
              <ComboboxItem<string> key={tag.id} value={tag.id}>
                <ComboboxItemText className="flex items-center gap-x-1">
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
            <ComboboxItem<string> key={tag.id} value={tag.id} disabled={!canChangeBindings}>
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
