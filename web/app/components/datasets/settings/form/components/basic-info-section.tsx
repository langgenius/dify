'use client'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { Member } from '@/models/common'
import type { DataSet, DatasetPermission, IconInfo } from '@/models/datasets'
import type { AppIconType } from '@/types/app'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import PermissionSelector from '../../permission-selector'

const rowClass = 'flex min-w-0 flex-col gap-2 @3xl/settings:flex-row @3xl/settings:gap-x-1'
const labelClass = 'flex shrink-0 flex-col pt-1 @3xl/settings:w-45'

type BasicInfoSectionProps = {
  currentDataset: DataSet | undefined
  name: string
  setName: (value: string) => void
  description: string
  setDescription: (value: string) => void
  iconInfo: IconInfo
  showAppIconPicker: boolean
  handleOpenAppIconPicker: () => void
  handleSelectAppIcon: (icon: AppIconSelection) => void
  setShowAppIconPicker: (show: boolean) => void
  permission: DatasetPermission | undefined
  setPermission: (value: DatasetPermission | undefined) => void
  selectedMemberIDs: string[]
  setSelectedMemberIDs: (value: string[]) => void
  memberList: Member[]
  readonly?: boolean
}

const BasicInfoSection = ({
  currentDataset,
  name,
  setName,
  description,
  setDescription,
  iconInfo,
  showAppIconPicker,
  handleOpenAppIconPicker,
  handleSelectAppIcon,
  setShowAppIconPicker,
  permission,
  setPermission,
  selectedMemberIDs,
  setSelectedMemberIDs,
  memberList,
  readonly = false,
}: BasicInfoSectionProps) => {
  const { t } = useTranslation(['datasetSettings'])
  const permissionLabelId = useId()

  return (
    <>
      {/* Dataset name and icon */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">
            {t(($) => $['form.nameAndIcon'], { ns: 'datasetSettings' })}
          </div>
        </div>
        <div className="flex min-w-0 grow items-center gap-x-2">
          <IconButton
            size="lg"
            aria-label={t(($) => $['form.changeIcon'], { ns: 'datasetSettings' })}
            disabled={readonly}
            onClick={handleOpenAppIconPicker}
          >
            <span aria-hidden="true">
              <AppIcon
                size="small"
                decorative
                iconType={iconInfo.icon_type as AppIconType}
                icon={iconInfo.icon}
                background={iconInfo.icon_background}
                imageUrl={iconInfo.icon_url}
              />
            </span>
          </IconButton>
          <Input
            aria-label={t(($) => $['form.name'], { ns: 'datasetSettings' })}
            disabled={!currentDataset?.embedding_available || readonly}
            value={name}
            onValueChange={(nextValue) => setName(nextValue)}
          />
        </div>
      </div>

      {/* Dataset description */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">
            {t(($) => $['form.desc'], { ns: 'datasetSettings' })}
          </div>
        </div>
        <div className="min-w-0 grow">
          <Textarea
            aria-label={t(($) => $['form.desc'], { ns: 'datasetSettings' })}
            disabled={!currentDataset?.embedding_available || readonly}
            className="resize-none"
            placeholder={t(($) => $['form.descPlaceholder'], { ns: 'datasetSettings' }) || ''}
            value={description}
            onValueChange={(value) => setDescription(value)}
          />
        </div>
      </div>

      {/* Permissions */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div id={permissionLabelId} className="system-sm-semibold text-text-secondary">
            {t(($) => $['form.permissions'], { ns: 'datasetSettings' })}
          </div>
        </div>
        <div className="min-w-0 grow">
          <PermissionSelector
            aria-labelledby={permissionLabelId}
            disabled={!currentDataset?.embedding_available || readonly}
            permission={permission}
            value={selectedMemberIDs}
            onChange={(v) => setPermission(v)}
            onMemberSelect={setSelectedMemberIDs}
            memberList={memberList}
          />
        </div>
      </div>

      {showAppIconPicker && (
        <AppIconPicker
          open={showAppIconPicker}
          initialEmoji={
            iconInfo.icon_type === 'emoji'
              ? { icon: iconInfo.icon, background: iconInfo.icon_background }
              : undefined
          }
          onOpenChange={setShowAppIconPicker}
          onSelect={handleSelectAppIcon}
        />
      )}
    </>
  )
}

export default BasicInfoSection
