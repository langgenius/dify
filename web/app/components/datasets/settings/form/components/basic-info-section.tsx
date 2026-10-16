'use client'
import type { IconPickerValue } from '@/app/components/base/icon-picker'
import type { Member } from '@/models/common'
import type { DataSet, DatasetPermission, IconInfo } from '@/models/datasets'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconPicker,
  IconPickerContent,
  IconPickerIcon,
  IconPickerTrigger,
} from '@/app/components/base/icon-picker'
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
  handleSelectAppIcon: (icon: IconPickerValue) => void
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
  handleSelectAppIcon,
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
          <IconPicker
            value={
              iconInfo.icon_type === 'emoji'
                ? {
                    type: 'emoji',
                    icon: iconInfo.icon,
                    background: iconInfo.icon_background,
                  }
                : { type: 'image', fileId: iconInfo.icon, url: iconInfo.icon_url || '' }
            }
            onValueChange={handleSelectAppIcon}
          >
            <IconPickerTrigger
              disabled={readonly}
              render={
                <IconButton
                  size="lg"
                  aria-label={t(($) => $['form.changeIcon'], { ns: 'datasetSettings' })}
                >
                  <span aria-hidden="true">
                    <IconPickerIcon size="small" />
                  </span>
                </IconButton>
              }
            />
            <IconPickerContent />
          </IconPicker>
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
    </>
  )
}

export default BasicInfoSection
