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
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { RiAddLine, RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import { useBoolean, useHover } from 'ahooks'
import * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import Input from '@/app/components/base/input'
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

  const deleteBtnRef = useRef<HTMLButtonElement>(null)
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
          <button
            type="button"
            aria-label={t('operation.edit', { ns: 'common' })}
            className="cursor-pointer rounded-md border-none bg-transparent p-0.5 hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            onClick={handleRename}
          >
            <RiEditLine className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            ref={deleteBtnRef}
            aria-label={t('operation.remove', { ns: 'common' })}
            className="cursor-pointer rounded-md border-none bg-transparent p-0.5 hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-1 focus-visible:ring-state-destructive-border focus-visible:outline-hidden"
            onClick={showDeleteConfirm}
          >
            <RiDeleteBinLine className="size-4" aria-hidden="true" />
          </button>
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
  const handleAdd = useCallback(async (data: BuiltInMetadataItem) => {
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
      open
      modal
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open)
          onClose()
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:top-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-[calc(100dvh-16px)] data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-[420px]">
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              <div className="flex shrink-0 justify-between px-4 pt-6 pb-4">
                <DrawerTitle className="text-lg leading-6 font-medium text-text-primary">
                  {t('metadata.metadata', { ns: 'dataset' })}
                </DrawerTitle>
                <DrawerCloseButton
                  aria-label={t('operation.close', { ns: 'common' })}
                  className="h-6 w-6 rounded-md"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
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
                  <Dialog
                    open
                    onOpenChange={(open) => {
                      if (!open)
                        setIsShowRenameModal(false)
                    }}
                  >
                    <DialogContent className="overflow-hidden! border-none text-left align-middle">
                      <DialogTitle className="title-2xl-semi-bold text-text-primary">
                        {t(`${i18nPrefix}.rename`, { ns: 'dataset' })}
                      </DialogTitle>

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
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
export default React.memo(DatasetMetadataDrawer)
