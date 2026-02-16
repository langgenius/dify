'use client'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { Member } from '@/models/common'
import type { DataSet, DatasetPermission, IconInfo } from '@/models/datasets'
import type { AppIconType } from '@/types/app'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import PermissionSelector from '../../permission-selector'

const rowClass = 'flex gap-x-1'
const labelClass = 'flex items-center shrink-0 w-[180px] h-7 pt-1'

type BasicInfoSectionProps = {
  currentDataset: DataSet | undefined
  isCurrentWorkspaceDatasetOperator: boolean
  name: string
  setName: (value: string) => void
  description: string
  setDescription: (value: string) => void
  iconInfo: IconInfo
  showAppIconPicker: boolean
  handleOpenAppIconPicker: () => void
  handleSelectAppIcon: (icon: AppIconSelection) => void
  handleCloseAppIconPicker: () => void
  permission: DatasetPermission | undefined
  setPermission: (value: DatasetPermission | undefined) => void
  selectedMemberIDs: string[]
  setSelectedMemberIDs: (value: string[]) => void
  memberList: Member[]
}

const BasicInfoSection = ({
  currentDataset,
  isCurrentWorkspaceDatasetOperator,
  name,
  setName,
  description,
  setDescription,
  iconInfo,
  showAppIconPicker,
  handleOpenAppIconPicker,
  handleSelectAppIcon,
  handleCloseAppIconPicker,
  permission,
  setPermission,
  selectedMemberIDs,
  setSelectedMemberIDs,
  memberList,
}: BasicInfoSectionProps) => {
  const { t } = useTranslation()

  return (
    <>
      {/* Dataset name and icon */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">{t('form.nameAndIcon', { ns: 'datasetSettings' })}</div>
        </div>
        <div className="flex grow items-center gap-x-2">
          <AppIcon
            size="small"
            onClick={handleOpenAppIconPicker}
            className="cursor-pointer"
            iconType={iconInfo.icon_type as AppIconType}
            icon={iconInfo.icon}
            background={iconInfo.icon_background}
            imageUrl={iconInfo.icon_url}
            showEditIcon
          />
          <Input
            disabled={!currentDataset?.embedding_available}
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
      </div>

      {/* Dataset description */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">{t('form.desc', { ns: 'datasetSettings' })}</div>
        </div>
        <div className="grow">
          <Textarea
            disabled={!currentDataset?.embedding_available}
            className="resize-none"
            placeholder={t('form.descPlaceholder', { ns: 'datasetSettings' }) || ''}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>
      </div>

      {/* Permissions */}
      <div className={rowClass}>
        <div className={labelClass}>
          <div className="system-sm-semibold text-text-secondary">{t('form.permissions', { ns: 'datasetSettings' })}</div>
        </div>
        <div className="grow">
          <PermissionSelector
            disabled={!currentDataset?.embedding_available || isCurrentWorkspaceDatasetOperator}
            permission={permission}
            value={selectedMemberIDs}
            onChange={v => setPermission(v)}
            onMemberSelect={setSelectedMemberIDs}
            memberList={memberList}
          />
        </div>
      </div>

      {showAppIconPicker && (
        <AppIconPicker
          onSelect={handleSelectAppIcon}
          onClose={handleCloseAppIconPicker}
        />
      )}
    </>
  )
}

export default BasicInfoSection
