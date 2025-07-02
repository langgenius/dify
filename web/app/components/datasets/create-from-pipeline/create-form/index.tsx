import AppIcon from '@/app/components/base/app-icon'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import type { Member } from '@/models/common'
import { DatasetPermission } from '@/models/datasets'
import { useMembers } from '@/service/use-common'
import type { AppIconType } from '@/types/app'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PermissionSelector from '../../settings/permission-selector'
import Button from '@/app/components/base/button'
import { RiCloseLine } from '@remixicon/react'
import Toast from '@/app/components/base/toast'
import type { CreateFormData } from '@/models/pipeline'

const DEFAULT_APP_ICON: AppIconSelection = {
  type: 'emoji',
  icon: '📙',
  background: '#FFF4ED',
}

type CreateFormProps = {
  onCreate: (payload: CreateFormData) => void
  onClose: () => void
}

const CreateForm = ({
  onCreate,
  onClose,
}: CreateFormProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [appIcon, setAppIcon] = useState<AppIconSelection>(DEFAULT_APP_ICON)
  const [description, setDescription] = useState('')
  const [permission, setPermission] = useState(DatasetPermission.onlyMe)
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [selectedMemberIDs, setSelectedMemberIDs] = useState<string[]>([])
  const previousAppIcon = useRef<AppIconSelection>(DEFAULT_APP_ICON)
  const [memberList, setMemberList] = useState<Member[]>([])

  const { data: members } = useMembers()

  useEffect(() => {
    if (members?.accounts)
      setMemberList(members.accounts)
  }, [members])

  const handleAppNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setName(value)
  }, [])

  const handleOpenAppIconPicker = useCallback(() => {
    setShowAppIconPicker(true)
    previousAppIcon.current = appIcon
  }, [appIcon])

  const handleSelectAppIcon = useCallback((icon: AppIconSelection) => {
    setAppIcon(icon)
    setShowAppIconPicker(false)
  }, [])

  const handleCloseAppIconPicker = useCallback(() => {
    setAppIcon(previousAppIcon.current)
    setShowAppIconPicker(false)
  }, [])

  const handleDescriptionChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    setDescription(value)
  }, [])

  const handlePermissionChange = useCallback((value?: DatasetPermission) => {
    setPermission(value!)
  }, [])

  const handleCreate = useCallback(() => {
    if (!name) {
      Toast.notify({
        type: 'error',
        message: 'Please enter a name for the Knowledge Base.',
      })
      return
    }
    onCreate({
      name,
      appIcon,
      description,
      permission,
      selectedMemberIDs,
    })
  }, [name, appIcon, description, permission, selectedMemberIDs, onCreate])

  return (
    <div className='relative flex flex-col'>
      {/* Header */}
      <div className='pb-3 pl-6 pr-14 pt-6'>
        <span className='title-2xl-semi-bold text-text-primary'>
          {t('datasetPipeline.creation.createKnowledge')}
        </span>
      </div>
      <button
        className='absolute right-5 top-5 flex size-8 items-center justify-center'
        onClick={onClose}
      >
        <RiCloseLine className='size-5 text-text-tertiary' />
      </button>
      {/* Form */}
      <div className='flex flex-col gap-y-5 px-6 py-3'>
        <div className='flex items-end gap-x-3 self-stretch'>
          <div className='flex grow flex-col gap-y-1 pb-1'>
            <label className='system-sm-medium flex h-6 items-center text-text-secondary'>
              {t('datasetPipeline.knowledgeNameAndIcon')}
            </label>
            <Input
              onChange={handleAppNameChange}
              value={name}
              placeholder={t('datasetPipeline.knowledgeNameAndIconPlaceholder')}
            />
          </div>
          <AppIcon
            size='xxl'
            onClick={handleOpenAppIconPicker}
            className='cursor-pointer'
            iconType={appIcon.type as AppIconType}
            icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
            background={appIcon.type === 'image' ? undefined : appIcon.background}
            imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
            showEditIcon
          />
        </div>
        <div className='flex flex-col gap-y-1'>
          <label className='system-sm-medium flex h-6 items-center text-text-secondary'>
            {t('datasetPipeline.knowledgeDescription')}
          </label>
          <Textarea
            onChange={handleDescriptionChange}
            value={description}
            placeholder={t('datasetPipeline.knowledgeDescriptionPlaceholder')}
          />
        </div>
        <div className='flex flex-col gap-y-1'>
          <label className='system-sm-medium flex h-6 items-center text-text-secondary'>
            {t('datasetPipeline.knowledgePermissions')}
          </label>
          <PermissionSelector
            permission={permission}
            value={selectedMemberIDs}
            onChange={handlePermissionChange}
            onMemberSelect={setSelectedMemberIDs}
            memberList={memberList}
          />
        </div>
      </div>
      {/* Actions */}
      <div className='flex items-center justify-end gap-x-2 p-6 pt-5'>
        <Button
          variant='secondary'
          onClick={onClose}
        >
          {t('common.operation.cancel')}
        </Button>
        <Button
          variant='primary'
          onClick={handleCreate}
        >
          {t('common.operation.create')}
        </Button>
      </div>
      {showAppIconPicker && (
        <AppIconPicker
          onSelect={handleSelectAppIcon}
          onClose={handleCloseAppIconPicker}
        />
      )}
    </div>
  )
}

export default React.memo(CreateForm)
