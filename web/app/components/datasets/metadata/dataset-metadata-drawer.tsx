'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import type { MetadataItemWithValueLength } from './types'
import Drawer from '../../base/drawer'
import Button from '@/app/components/base/button'
import { RiAddLine, RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import { getIcon } from './utils/get-icon'
import cn from '@/utils/classnames'
import Modal from '../../base/modal'
import Field from './field'
import Input from '@/app/components/base/input'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import Switch from '../../base/switch'
import Tooltip from '../../base/tooltip'
import CreateModal from '@/app/components/datasets/metadata/create-metadata-modal'

const i18nPrefix = 'dataset.metadata.datasetMetadata'

type Props = {
  userMetadata: MetadataItemWithValueLength[]
  builtInMetadata: MetadataItemWithValueLength[]
  isBuiltInEnabled: boolean
  onIsBuiltInEnabledChange: (value: boolean) => void
  onClose: () => void
  onChange: (data: MetadataItemWithValueLength[]) => void
}

type ItemProps = {
  readonly?: boolean
  payload: MetadataItemWithValueLength
  onRename?: () => void
  onDelete?: () => void
}
const Item: FC<ItemProps> = ({
  readonly,
  payload,
  onRename,
  onDelete,
}) => {
  const Icon = getIcon(payload.type)

  const handleRename = useCallback(() => {
    onRename?.()
  }, [onRename])

  const handleDelete = useCallback(() => {
    onDelete?.()
  }, [onDelete])

  return (
    <div
      key={payload.id}
      className={cn(!readonly && 'group/item', 'mx-1 flex items-center h-6  px-3 justify-between rounded-md hover:bg-state-base-hover cursor-pointer')}
    >
      <div className='w-0 grow flex items-center h-full text-text-secondary'>
        <Icon className='shrink-0 mr-[5px] size-3.5' />
        <div className='w-0 grow truncate system-sm-medium'>{payload.name}</div>
      </div>
      <div className='group-hover/item:hidden ml-1 shrink-0 system-xs-regular text-text-tertiary'>
        {payload.valueLength || 0} values
      </div>
      <div className='group-hover/item:flex hidden items-center h-6 px-3 text-text-secondary rounded-md hover:bg-state-base-hover cursor-pointer space-x-1'>
        <RiEditLine className='size-4 cursor-pointer' onClick={handleRename} />
        <RiDeleteBinLine className='size-4 cursor-pointer' onClick={handleDelete} />
      </div>
    </div>
  )
}

const DatasetMetadataDrawer: FC<Props> = ({
  userMetadata,
  builtInMetadata,
  isBuiltInEnabled,
  onIsBuiltInEnabledChange,
  onClose,
  onChange,
}) => {
  const { t } = useTranslation()
  const [isShowRenameModal, setIsShowRenameModal] = useState(false)
  const [currPayload, setCurrPayload] = useState<MetadataItemWithValueLength | null>(null)
  const [templeName, setTempleName] = useState('')
  const handleRename = useCallback((payload: MetadataItemWithValueLength) => {
    return () => {
      setCurrPayload(payload)
      setTempleName(payload.name)
      setIsShowRenameModal(true)
    }
  }, [setCurrPayload, setIsShowRenameModal])

  const handleAdd = useCallback((data: MetadataItemWithValueLength) => {
    const nextUserMetadata = produce(userMetadata, (draft) => {
      draft.push(data)
    })
    onChange(nextUserMetadata)
  }, [userMetadata, onChange])

  const handleRenamed = useCallback(() => {
    const nextUserMetadata = produce(userMetadata, (draft) => {
      const index = draft.findIndex(p => p.id === currPayload?.id)
      if (index !== -1)
        draft[index].name = templeName!
    })

    onChange(nextUserMetadata)
    setIsShowRenameModal(false)
  }, [currPayload, templeName, userMetadata, onChange])

  const handleDelete = useCallback((payload: MetadataItemWithValueLength) => {
    return () => {
      const nextUserMetadata = userMetadata.filter(p => p.id !== payload.id)
      onChange(nextUserMetadata)
    }
  }, [userMetadata, onChange])

  return (
    <Drawer
      isOpen={true}
      onClose={onClose}
      showClose
      title='Metadata'
      footer={null}
      panelClassname='block !max-w-[420px] my-2 rounded-l-2xl'
    >
      <div className='system-sm-regular text-text-tertiary'>You can manage all metadata in this knowledge here. Modifications will be synchronized to every document.</div>

      <CreateModal trigger={<Button variant='primary' className='mt-3'>
        <RiAddLine className='mr-1' />
        Add Metadata
      </Button>} hasBack onSave={handleAdd} />

      {userMetadata.map(payload => (
        <Item
          key={payload.id}
          payload={payload}
          onRename={handleRename(payload)}
          onDelete={handleDelete(payload)}
        />
      ))}

      <div className='flex'>
        <Switch
          defaultValue={isBuiltInEnabled}
          onChange={onIsBuiltInEnabledChange}
        />
        <div>Built-in</div>
        <Tooltip popupContent="xxx" />
      </div>

      {builtInMetadata.map(payload => (
        <Item
          key={payload.id}
          readonly
          payload={payload}
        />
      ))}

      {isShowRenameModal && (
        <Modal isShow title="rename">
          <Field label={t(`${i18nPrefix}.name`)}>
            <Input
              value={templeName}
              onChange={e => setTempleName(e.target.value)}
              placeholder={t(`${i18nPrefix}.namePlaceholder`)}
            />
          </Field>
          <div className='mt-4 flex justify-end'>
            <Button
              className='mr-2'
              onClick={() => {
                setIsShowRenameModal(false)
                setTempleName(currPayload!.name)
              }}>{t('common.operation.cancel')}</Button>
            <Button
              onClick={handleRenamed}
              variant='primary'
              disabled={!templeName}
            >{t('common.operation.save')}</Button>
          </div>
        </Modal>
      )}

    </Drawer>
  )
}
export default React.memo(DatasetMetadataDrawer)
