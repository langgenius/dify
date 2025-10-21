'use client'
import type { FC } from 'react'
import React, { useCallback, useRef, useState } from 'react'
import type { BuiltInMetadataItem, MetadataItemWithValueLength } from '../types'
import Drawer from '@/app/components/base/drawer'
import Button from '@/app/components/base/button'
import { RiAddLine, RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import { getIcon } from '../utils/get-icon'
import cn from '@/utils/classnames'
import Modal from '@/app/components/base/modal'
import Field from './field'
import Input from '@/app/components/base/input'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import CreateModal from '@/app/components/datasets/metadata/metadata-dataset/create-metadata-modal'
import { useBoolean, useHover } from 'ahooks'
import Confirm from '@/app/components/base/confirm'
import Toast from '@/app/components/base/toast'

const i18nPrefix = 'dataset.metadata.datasetMetadata'

type Props = {
  userMetadata: MetadataItemWithValueLength[]
  builtInMetadata: BuiltInMetadataItem[]
  isBuiltInEnabled: boolean
  onIsBuiltInEnabledChange: (value: boolean) => void
  onClose: () => void
  onAdd: (payload: BuiltInMetadataItem) => void
  onRename: (payload: MetadataItemWithValueLength) => void
  onRemove: (metaDataId: string) => void
}

type ItemProps = {
  readonly?: boolean
  disabled?: boolean
  payload: MetadataItemWithValueLength
  onRename?: () => void
  onDelete?: () => void
}
const Item: FC<ItemProps> = ({
  readonly,
  disabled,
  payload,
  onRename,
  onDelete,
}) => {
  const { t } = useTranslation()
  const Icon = getIcon(payload.type)

  const handleRename = useCallback(() => {
    onRename?.()
  }, [onRename])

  const deleteBtnRef = useRef<HTMLDivElement>(null)
  const isDeleteHovering = useHover(deleteBtnRef)
  const [isShowDeleteConfirm, {
    setTrue: showDeleteConfirm,
    setFalse: hideDeleteConfirm,
  }] = useBoolean(false)
  const handleDelete = useCallback(() => {
    hideDeleteConfirm()
    onDelete?.()
  }, [hideDeleteConfirm, onDelete])

  return (
    <div
      key={payload.name}
      className={cn(
        !readonly && !disabled && 'group/item cursor-pointer hover:shadow-xs',
        'rounded-md border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg',
        isDeleteHovering && 'border border-state-destructive-border bg-state-destructive-hover',
      )}
    >
      <div
        className={cn(
          'flex h-8 items-center justify-between  px-2',
          disabled && 'opacity-30', // not include border and bg
        )}
      >
        <div className='flex h-full items-center space-x-1 text-text-tertiary'>
          <Icon className='size-4 shrink-0' />
          <div className='system-sm-medium max-w-[250px] truncate text-text-primary'>{payload.name}</div>
          <div className='system-xs-regular shrink-0'>{payload.type}</div>
        </div>
        {(!readonly || disabled) && (
          <div className='system-xs-regular ml-2 shrink-0 text-text-tertiary group-hover/item:hidden'>
            {disabled ? t(`${i18nPrefix}.disabled`) : t(`${i18nPrefix}.values`, { num: payload.count || 0 })}
          </div>
        )}
        <div className='ml-2 hidden items-center space-x-1 text-text-tertiary group-hover/item:flex'>
          <RiEditLine className='size-4 cursor-pointer' onClick={handleRename} />
          <div ref={deleteBtnRef} className='hover:text-text-destructive'>
            <RiDeleteBinLine className='size-4 cursor-pointer' onClick={showDeleteConfirm} />
          </div>
        </div>
        {isShowDeleteConfirm && (
          <Confirm
            isShow
            type='warning'
            title={t('dataset.metadata.datasetMetadata.deleteTitle')}
            content={t('dataset.metadata.datasetMetadata.deleteContent', { name: payload.name })}
            onConfirm={handleDelete}
            onCancel={hideDeleteConfirm}
          />
        )}
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
  onAdd,
  onRename,
  onRemove,
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

  const [open, setOpen] = useState(false)
  const handleAdd = useCallback(async (data: MetadataItemWithValueLength) => {
    await onAdd(data)
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    setOpen(false)
  }, [onAdd, t])

  const handleRenamed = useCallback(async () => {
    const item = userMetadata.find(p => p.id === currPayload?.id)
    if (item) {
      await onRename({
        ...item,
        name: templeName,
      })
      Toast.notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })
    }
    setIsShowRenameModal(false)
  }, [userMetadata, currPayload?.id, onRename, templeName, t])

  const handleDelete = useCallback((payload: MetadataItemWithValueLength) => {
    return async () => {
      await onRemove(payload.id)
      Toast.notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })
    }
  }, [onRemove, t])

  return (
    <Drawer
      isOpen={true}
      onClose={onClose}
      showClose
      title={t('dataset.metadata.metadata')}
      footer={null}
      panelClassName='px-4 block !max-w-[420px] my-2 rounded-l-2xl'
    >
      <div className='h-full overflow-y-auto'>
        <div className='system-sm-regular text-text-tertiary'>{t(`${i18nPrefix}.description`)}</div>
        <CreateModal
          open={open}
          setOpen={setOpen}
          trigger={<Button variant='primary' className='mt-3'>
            <RiAddLine className='mr-1' />
            {t(`${i18nPrefix}.addMetaData`)}
          </Button>} hasBack onSave={handleAdd}
        />

        <div className='mt-3 space-y-1'>
          {userMetadata.map(payload => (
            <Item
              key={payload.id}
              payload={payload}
              onRename={handleRename(payload)}
              onDelete={handleDelete(payload)}
            />
          ))}
        </div>

        <div className='mt-3 flex h-6 items-center'>
          <Switch
            defaultValue={isBuiltInEnabled}
            onChange={onIsBuiltInEnabledChange}
          />
          <div className='system-sm-semibold ml-2 mr-0.5 text-text-secondary'>{t(`${i18nPrefix}.builtIn`)}</div>
          <Tooltip popupContent={<div className='max-w-[100px]'>{t(`${i18nPrefix}.builtInDescription`)}</div>} />
        </div>

        <div className='mt-1 space-y-1'>
          {builtInMetadata.map(payload => (
            <Item
              key={payload.name}
              readonly
              disabled={!isBuiltInEnabled}
              payload={payload as MetadataItemWithValueLength}
            />
          ))}
        </div>

        {isShowRenameModal && (
          <Modal isShow title={t(`${i18nPrefix}.rename`)} onClose={() => setIsShowRenameModal(false)}>
            <Field label={t(`${i18nPrefix}.name`)} className='mt-4'>
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
      </div>
    </Drawer>
  )
}
export default React.memo(DatasetMetadataDrawer)
