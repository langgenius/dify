'use client'
import type { FC } from 'react'
import type { BuiltInMetadataItem, MetadataItemInBatchEdit, MetadataItemWithEdit } from '../types'
import { RiQuestionLine } from '@remixicon/react'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Toast from '@/app/components/base/toast'
import { useCreateMetaData } from '@/service/knowledge/use-metadata'
import Button from '../../../base/button'
import Checkbox from '../../../base/checkbox'
import Modal from '../../../base/modal'
import Tooltip from '../../../base/tooltip'
import AddMetadataButton from '../add-metadata-button'
import useCheckMetadataName from '../hooks/use-check-metadata-name'
import SelectMetadataModal from '../metadata-dataset/select-metadata-modal'
import { UpdateType } from '../types'
import AddedMetadataItem from './add-row'
import EditMetadataBatchItem from './edit-row'

const i18nPrefix = 'metadata.batchEditMetadata'

type Props = {
  datasetId: string
  documentNum: number
  list: MetadataItemInBatchEdit[]
  onSave: (editedList: MetadataItemInBatchEdit[], addedList: MetadataItemInBatchEdit[], isApplyToAllSelectDocument: boolean) => void
  onHide: () => void
  onShowManage: () => void
}

const EditMetadataBatchModal: FC<Props> = ({
  datasetId,
  documentNum,
  list,
  onSave,
  onHide,
  onShowManage,
}) => {
  const { t } = useTranslation()
  const [templeList, setTempleList] = useState<MetadataItemWithEdit[]>(list)
  const handleTemplesChange = useCallback((payload: MetadataItemWithEdit) => {
    const newTempleList = produce(templeList, (draft) => {
      const index = draft.findIndex(i => i.id === payload.id)
      if (index !== -1) {
        draft[index] = payload
        draft[index].isUpdated = true
        draft[index].updateType = UpdateType.changeValue
      }
    })
    setTempleList(newTempleList)
  }, [templeList])
  const handleTempleItemRemove = useCallback((id: string) => {
    const newTempleList = produce(templeList, (draft) => {
      const index = draft.findIndex(i => i.id === id)
      if (index !== -1) {
        draft[index].isUpdated = true
        draft[index].updateType = UpdateType.delete
      }
    })
    setTempleList(newTempleList)
  }, [templeList])

  const handleItemReset = useCallback((id: string) => {
    const newTempleList = produce(templeList, (draft) => {
      const index = draft.findIndex(i => i.id === id)
      if (index !== -1) {
        draft[index] = { ...list[index] }
        draft[index].isUpdated = false
        delete draft[index].updateType
      }
    })
    setTempleList(newTempleList)
  }, [list, templeList])

  const { checkName } = useCheckMetadataName()
  const { mutate: doAddMetaData } = useCreateMetaData(datasetId)
  const handleAddMetaData = useCallback(async (payload: BuiltInMetadataItem) => {
    const errorMsg = checkName(payload.name).errorMsg
    if (errorMsg) {
      Toast.notify({
        message: errorMsg,
        type: 'error',
      })
      return Promise.reject(new Error(errorMsg))
    }
    await doAddMetaData(payload)
    Toast.notify({
      type: 'success',
      message: t('api.actionSuccess', { ns: 'common' }),
    })
  }, [checkName, doAddMetaData, t])

  const [addedList, setAddedList] = useState<MetadataItemWithEdit[]>([])
  const handleAddedListChange = useCallback((payload: MetadataItemWithEdit) => {
    const newAddedList = addedList.map(i => i.id === payload.id ? payload : i)
    setAddedList(newAddedList)
  }, [addedList])
  const handleAddedItemRemove = useCallback((removeIndex: number) => {
    return () => {
      const newAddedList = addedList.filter((i, index) => index !== removeIndex)
      setAddedList(newAddedList)
    }
  }, [addedList])

  const [isApplyToAllSelectDocument, setIsApplyToAllSelectDocument] = useState(false)

  const handleSave = useCallback(() => {
    onSave(templeList.filter(item => item.updateType !== UpdateType.delete), addedList, isApplyToAllSelectDocument)
  }, [templeList, addedList, isApplyToAllSelectDocument, onSave])
  return (
    <Modal
      title={t(`${i18nPrefix}.editMetadata`, { ns: 'dataset' })}
      isShow
      closable
      onClose={onHide}
      className="!max-w-[640px]"
    >
      <div className="system-xs-medium mt-1 text-text-accent">{t(`${i18nPrefix}.editDocumentsNum`, { ns: 'dataset', num: documentNum })}</div>
      <div className="max-h-[305px] overflow-y-auto overflow-x-hidden">
        <div className="mt-4 space-y-2">
          {templeList.map(item => (
            <EditMetadataBatchItem
              key={item.id}
              payload={item}
              onChange={handleTemplesChange}
              onRemove={handleTempleItemRemove}
              onReset={handleItemReset}
            />
          ))}
        </div>
        <div className="mt-4 pl-[18px]">
          <div className="flex items-center">
            <div className="system-xs-medium-uppercase mr-2 shrink-0 text-text-tertiary">{t('metadata.createMetadata.title', { ns: 'dataset' })}</div>
            <Divider bgStyle="gradient" />
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
            <SelectMetadataModal
              datasetId={datasetId}
              popupPlacement="top-start"
              popupOffset={{ mainAxis: 4, crossAxis: 0 }}
              trigger={
                <AddMetadataButton />
              }
              onSave={handleAddMetaData}
              onSelect={data => setAddedList([...addedList, data as MetadataItemWithEdit])}
              onManage={onShowManage}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex select-none items-center">
          <Checkbox checked={isApplyToAllSelectDocument} onCheck={() => setIsApplyToAllSelectDocument(!isApplyToAllSelectDocument)} />
          <div className="system-xs-medium ml-2 mr-1 text-text-secondary">{t(`${i18nPrefix}.applyToAllSelectDocument`, { ns: 'dataset' })}</div>
          <Tooltip popupContent={
            <div className="max-w-[240px]">{t(`${i18nPrefix}.applyToAllSelectDocumentTip`, { ns: 'dataset' })}</div>
          }
          >
            <div className="cursor-pointer p-px">
              <RiQuestionLine className="size-3.5 text-text-tertiary" />
            </div>
          </Tooltip>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            onClick={onHide}
          >
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button
            onClick={handleSave}
            variant="primary"
          >
            {t('operation.save', { ns: 'common' })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
export default React.memo(EditMetadataBatchModal)
