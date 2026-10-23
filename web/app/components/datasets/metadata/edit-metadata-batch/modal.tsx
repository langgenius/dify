'use client'
import type { FC } from 'react'
import type { BuiltInMetadataItem, MetadataItemInBatchEdit, MetadataItemWithEdit } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Separator } from '@langgenius/dify-ui/separator'
import { useMutation } from '@tanstack/react-query'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import useCheckMetadataName from '../hooks/use-check-metadata-name'
import { DatasetMetadataPicker } from '../metadata-dataset/dataset-metadata-picker'
import { UpdateType } from '../types'
import AddedMetadataItem from './add-row'
import EditMetadataBatchItem from './edit-row'

const i18nPrefix = 'metadata.batchEditMetadata'
type Props = Readonly<{
  datasetId: string
  documentNum: number
  list: MetadataItemInBatchEdit[]
  onSave: (
    editedList: MetadataItemInBatchEdit[],
    addedList: MetadataItemInBatchEdit[],
    isApplyToAllSelectDocument: boolean,
  ) => void
  onHide: () => void
  onShowManage: () => void
}>
const EditMetadataBatchModal: FC<Props> = ({
  datasetId,
  documentNum,
  list,
  onSave,
  onHide,
  onShowManage,
}) => {
  const applyToAllLabelId = React.useId()

  const { t } = useTranslation(['common', 'dataset'])
  const [templeList, setTempleList] = useState<MetadataItemWithEdit[]>(list)
  const handleTemplesChange = useCallback(
    (payload: MetadataItemWithEdit) => {
      const newTempleList = produce(templeList, (draft) => {
        const index = draft.findIndex((i) => i.id === payload.id)
        if (index !== -1) {
          draft[index] = payload
          draft[index].isUpdated = true
          draft[index].updateType = UpdateType.changeValue
        }
      })
      setTempleList(newTempleList)
    },
    [templeList],
  )
  const handleTempleItemRemove = useCallback(
    (id: string) => {
      const newTempleList = produce(templeList, (draft) => {
        const index = draft.findIndex((i) => i.id === id)
        if (index !== -1) {
          draft[index]!.isUpdated = true
          draft[index]!.updateType = UpdateType.delete
        }
      })
      setTempleList(newTempleList)
    },
    [templeList],
  )
  const handleItemReset = useCallback(
    (id: string) => {
      const newTempleList = produce(templeList, (draft) => {
        const index = draft.findIndex((i) => i.id === id)
        if (index !== -1) {
          draft[index] = { ...list[index]! }
          draft[index]!.isUpdated = false
          delete draft[index]!.updateType
        }
      })
      setTempleList(newTempleList)
    },
    [list, templeList],
  )
  const { checkName } = useCheckMetadataName()
  const { mutateAsync: createMetaData } = useMutation(
    consoleQuery.datasets.byDatasetId.metadata.post.mutationOptions(),
  )
  const handleAddMetaData = useCallback(
    async (payload: BuiltInMetadataItem) => {
      const errorMsg = checkName(payload.name).errorMsg
      if (errorMsg) {
        toast.error(errorMsg)
        return Promise.reject(new Error(errorMsg))
      }
      await createMetaData({ params: { dataset_id: datasetId }, body: payload })
      toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
    },
    [checkName, createMetaData, datasetId, t],
  )
  const [addedList, setAddedList] = useState<MetadataItemWithEdit[]>([])
  const handleAddedListChange = useCallback(
    (payload: MetadataItemWithEdit) => {
      const newAddedList = addedList.map((i) => (i.id === payload.id ? payload : i))
      setAddedList(newAddedList)
    },
    [addedList],
  )
  const handleAddedItemRemove = useCallback(
    (removeIndex: number) => {
      return () => {
        const newAddedList = addedList.filter((i, index) => index !== removeIndex)
        setAddedList(newAddedList)
      }
    },
    [addedList],
  )
  const [isApplyToAllSelectDocument, setIsApplyToAllSelectDocument] = useState(false)
  const handleSave = useCallback(() => {
    onSave(
      templeList.filter((item) => item.updateType !== UpdateType.delete),
      addedList,
      isApplyToAllSelectDocument,
    )
  }, [templeList, addedList, isApplyToAllSelectDocument, onSave])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onHide()
      }}
    >
      <DialogContent className="w-160">
        <DialogHeader>
          <DialogTitle>{t(($) => $[`${i18nPrefix}.editMetadata`], { ns: 'dataset' })}</DialogTitle>
          <div className="system-xs-medium text-text-accent">
            {t(($) => $[`${i18nPrefix}.editDocumentsNum`], { ns: 'dataset', num: documentNum })}
          </div>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody>
          <div className="space-y-2">
            {templeList.map((item) => (
              <EditMetadataBatchItem
                key={item.id}
                payload={item}
                onChange={handleTemplesChange}
                onRemove={handleTempleItemRemove}
                onReset={handleItemReset}
              />
            ))}
          </div>
          <div className="mt-4 pl-4.5">
            <div className="flex items-center">
              <div className="mr-2 shrink-0 system-xs-medium-uppercase text-text-tertiary">
                {t(($) => $['metadata.createMetadata.title'], { ns: 'dataset' })}
              </div>
              <Separator decorative className="my-2 h-[0.5px]" variant="gradient" />
            </div>
            <div className="mt-2 space-y-2">
              {addedList.map((item, i) => (
                <AddedMetadataItem
                  key={i}
                  payload={item}
                  onChange={handleAddedListChange}
                  onRemove={handleAddedItemRemove(i)}
                />
              ))}
            </div>
            <div className="mt-3">
              <DatasetMetadataPicker
                datasetId={datasetId}
                side="top"
                sideOffset={4}
                alignOffset={0}
                onCreateMetadata={handleAddMetaData}
                onSelectMetadata={(data) =>
                  setAddedList([...addedList, data as MetadataItemWithEdit])
                }
                onOpenMetadataManagement={onShowManage}
              />
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <div className="me-auto flex items-center select-none">
            <label className="flex cursor-pointer items-center">
              <Checkbox
                checked={isApplyToAllSelectDocument}
                onCheckedChange={setIsApplyToAllSelectDocument}
              />
              <span
                id={applyToAllLabelId}
                className="mr-1 ml-2 system-xs-medium text-text-secondary"
              >
                {t(($) => $[`${i18nPrefix}.applyToAllSelectDocument`], { ns: 'dataset' })}
              </span>
            </label>
            <Infotip>
              <InfotipTrigger
                aria-labelledby={applyToAllLabelId}
                className="p-px text-text-tertiary"
              />
              <InfotipContent aria-labelledby={applyToAllLabelId} className="max-w-60">
                {t(($) => $[`${i18nPrefix}.applyToAllSelectDocumentTip`], { ns: 'dataset' })}
              </InfotipContent>
            </Infotip>
          </div>
          <Button onClick={onHide}>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
          <Button onClick={handleSave} variant="primary">
            {t(($) => $['operation.save'], { ns: 'common' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(EditMetadataBatchModal)
