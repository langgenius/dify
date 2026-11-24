import type { TagType } from '@dify/contracts/api/console/tags/types.gen'
import type { TagComboboxItem } from './tag-option'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
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
import { getTagManagePermissionKey } from './permissions'
import { isCreateTagOption } from './tag-option'

type TagSearchContentProps = {
  type: TagType
  nameTooLong?: boolean
  isTagCatalogEmpty?: boolean
  onOpenTagManagement?: () => void
  onClose?: () => void
  canBindOrUnbindTags?: boolean
  requiresTargetEditPermission?: boolean
  showTagManagement?: boolean
  allowCreate?: boolean
}

type TagSearchContentViewProps = TagSearchContentProps & {
  canManageTags: boolean
}

export const TagSearchContentView = ({
  type,
  nameTooLong = false,
  isTagCatalogEmpty = false,
  onOpenTagManagement,
  onClose,
  canBindOrUnbindTags = false,
  requiresTargetEditPermission = false,
  showTagManagement = true,
  allowCreate = true,
  canManageTags,
}: TagSearchContentViewProps) => {
  const { t } = useTranslation(['common'])
  const canChangeBindings = requiresTargetEditPermission
    ? canBindOrUnbindTags
    : canBindOrUnbindTags || canManageTags
  const canCreate = allowCreate && canManageTags
  const isCardTagSelector = allowCreate && (type === 'agent' || type === 'app')
  const placeholder = canCreate
    ? t(($) => $['tag.selectorPlaceholder'], { ns: 'common' })
    : t(($) => $['tag.searchTags'], { ns: 'common' })
  const showEmptyCatalog = isCardTagSelector && isTagCatalogEmpty
  const emptyMessage = showEmptyCatalog
    ? canCreate
      ? t(($) => $['tag.noTagsYetCreateHint'])
      : t(($) => $['tag.noTagsYet'])
    : t(($) => $['tag.noTag'])

  return (
    <>
      <ComboboxInputGroup className="mb-1 in-data-dify-combobox-popup:mx-2 in-data-dify-combobox-popup:mt-2">
        <span aria-hidden="true" className="i-ri-search-line size-4 shrink-0 text-text-tertiary" />
        <ComboboxInput
          aria-label={placeholder}
          aria-invalid={nameTooLong || undefined}
          name={`tag-search-${type}`}
          placeholder={placeholder}
        />
      </ComboboxInputGroup>
      <ComboboxList<TagComboboxItem> className="max-h-58">
        {(tag) => {
          if (isCreateTagOption(tag)) {
            if (!canCreate) return null
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
      {!nameTooLong && (
        <ComboboxEmpty className="p-1">
          <div className="flex flex-col items-center gap-y-1 p-3">
            <span
              className={cn(
                'size-6 text-text-quaternary',
                showEmptyCatalog
                  ? 'i-ri-price-tag-3-line'
                  : 'i-custom-vender-line-financeAndECommerce-tag-01',
              )}
              aria-hidden="true"
            />
            <p className="text-center system-xs-regular wrap-break-word text-text-tertiary">
              {emptyMessage}
            </p>
          </div>
        </ComboboxEmpty>
      )}
      {canManageTags && showTagManagement && (
        <>
          <ComboboxSeparator />
          <div className="p-1">
            <Button
              variant="ghost"
              size="medium"
              className="w-full justify-start gap-x-1 px-2 py-1.5 text-start"
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
