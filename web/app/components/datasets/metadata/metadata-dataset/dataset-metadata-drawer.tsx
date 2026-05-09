'use client'
import type { FC } from 'react'
import type { BuiltInMetadataItem, MetadataItemWithValueLength } from '../types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { RiAddLine, RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import { useBoolean, useHover } from 'ahooks'
import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Drawer from '@/app/components/base/drawer'
import { Infotip } from '@/app/components/base/infotip'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import CreateModal from '@/app/components/datasets/metadata/metadata-dataset/create-metadata-modal'
import { getIcon } from '../utils/get-icon'
import Field from './field'

const i18nPrefix = 'metadata.datasetMetadata'

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
          'flex h-8 items-center justify-between px-2',
          disabled && 'opacity-30', // not include border and bg
        )}
      >
        <div className="flex h-full items-center space-x-1 text-text-tertiary">
          <Icon className="size-4 shrink-0" />
          <div className="max-w-[250px] truncate system-sm-medium text-text-primary">{payload.name}</div>
          <div className="shrink-0 system-xs-regular">{payload.type}</div>
        </div>
        {(!readonly || disabled) && (
          <div className="ml-2 shrink-0 system-xs-regular text-text-tertiary group-hover/item:hidden">
            {disabled ? t(`${i18nPrefix}.disabled`, { ns: 'dataset' }) : t(`${i18nPrefix}.values`, { ns: 'dataset', num: payload.count || 0 })}
          </div>
        )}
        <div className="ml-2 hidden items-center space-x-1 text-text-tertiary group-hover/item:flex">
          <RiEditLine className="size-4 cursor-pointer" onClick={handleRename} />
          <div ref={deleteBtnRef} className="hover:text-text-destructive">
            <RiDeleteBinLine className="size-4 cursor-pointer" onClick={showDeleteConfirm} />
          </div>
        </div>
        <AlertDialog open={isShowDeleteConfirm} onOpenChange={open => !open && hideDeleteConfirm()}>
          <AlertDialogContent>
            <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
              <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                {t('metadata.datasetMetadata.deleteTitle', { ns: 'dataset' })}
              </AlertDialogTitle>
              <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                {t('metadata.datasetMetadata.deleteContent', { ns: 'dataset', name: payload.name })}
              </AlertDialogDescription>
            </div>
            <AlertDialogActions>
              <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
              <AlertDialogConfirmButton onClick={handleDelete}>
                {t('operation.confirm', { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogActions>
          </AlertDialogContent>
        </AlertDialog>
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
    toast.success(t('api.actionSuccess', { ns: 'common' }))
    setOpen(false)
  }, [onAdd, t])

  const handleRenamed = useCallback(async () => {
    const item = userMetadata.find(p => p.id === currPayload?.id)
    if (item) {
      await onRename({
        ...item,
        name: templeName,
      })
      toast.success(t('api.actionSuccess', { ns: 'common' }))
    }
    setIsShowRenameModal(false)
  }, [userMetadata, currPayload?.id, onRename, templeName, t])

  const handleDelete = useCallback((payload: MetadataItemWithValueLength) => {
    return async () => {
      await onRemove(payload.id)
      toast.success(t('api.actionSuccess', { ns: 'common' }))
    }
  }, [onRemove, t])

  return (
    <Drawer
      isOpen={true}
      onClose={onClose}
      showClose
      title={t('metadata.metadata', { ns: 'dataset' })}
      footer={null}
      panelClassName="px-4 block max-w-[420px]! my-2 rounded-l-2xl"
    >
      <div className="h-full overflow-y-auto">
        <div className="system-sm-regular text-text-tertiary">{t(`${i18nPrefix}.description`, { ns: 'dataset' })}</div>
        <CreateModal
          open={open}
          setOpen={setOpen}
          trigger={(
            <Button variant="primary" className="mt-3">
              <RiAddLine className="mr-1" />
              {t(`${i18nPrefix}.addMetaData`, { ns: 'dataset' })}
            </Button>
          )}
          hasBack
          onSave={handleAdd}
        />

        <div className="mt-3 space-y-1">
          {userMetadata.map(payload => (
            <Item
              key={payload.id}
              payload={payload}
              onRename={handleRename(payload)}
              onDelete={handleDelete(payload)}
            />
          ))}
        </div>

        <div className="mt-3 flex h-6 items-center">
          <Switch
            checked={isBuiltInEnabled}
            onCheckedChange={onIsBuiltInEnabledChange}
          />
          <div className="mr-0.5 ml-2 system-sm-semibold text-text-secondary">{t(`${i18nPrefix}.builtIn`, { ns: 'dataset' })}</div>
          <Infotip aria-label={t(`${i18nPrefix}.builtInDescription`, { ns: 'dataset' })} popupClassName="max-w-[100px]">
            {t(`${i18nPrefix}.builtInDescription`, { ns: 'dataset' })}
          </Infotip>
        </div>

        <div className="mt-1 space-y-1">
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
          <Modal isShow title={t(`${i18nPrefix}.rename`, { ns: 'dataset' })} onClose={() => setIsShowRenameModal(false)}>
            <Field label={t(`${i18nPrefix}.name`, { ns: 'dataset' })} className="mt-4">
              <Input
                value={templeName}
                onChange={e => setTempleName(e.target.value)}
                placeholder={t(`${i18nPrefix}.namePlaceholder`, { ns: 'dataset' })}
              />
            </Field>
            <div className="mt-4 flex justify-end">
              <Button
                className="mr-2"
                onClick={() => {
                  setIsShowRenameModal(false)
                  setTempleName(currPayload!.name)
                }}
              >
                {t('operation.cancel', { ns: 'common' })}
              </Button>
              <Button
                onClick={handleRenamed}
                variant="primary"
                disabled={!templeName}
              >
                {t('operation.save', { ns: 'common' })}
              </Button>
            </div>
          </Modal>
        )}
      </div>
    </Drawer>
  )
}
export default React.memo(DatasetMetadataDrawer)
