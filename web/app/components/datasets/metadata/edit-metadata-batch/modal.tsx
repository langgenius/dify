'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import Modal from '../../../base/modal'
import type { MetadataItemInBatchEdit } from '../types'
import { DataType, type MetadataItemWithEdit, UpdateType } from '../types'
import EditMetadataBatchItem from './edit-row'
import AddedMetadataItem from './add-row'
import Button from '../../../base/button'
import { useTranslation } from 'react-i18next'
import Checkbox from '../../../base/checkbox'
import Tooltip from '../../../base/tooltip'
import SelectMetadataModal from '../metadata-dataset/select-metadata-modal'
import { RiQuestionLine } from '@remixicon/react'
import Divider from '@/app/components/base/divider'
import AddMetadataButton from '../add-metadata-button'
import produce from 'immer'

const i18nPrefix = 'dataset.metadata.batchEditMetadata'

type Props = {
  documentNum: number
  list: MetadataItemInBatchEdit[]
  onSave: (list: MetadataItemInBatchEdit[], isApplyToAllSelectDocument: boolean) => void
  onHide: () => void
}

const EditMetadataBatchModal: FC<Props> = ({
  documentNum,
  list,
  onSave,
  onHide,
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
    },
    )
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

  const testAddedList: MetadataItemWithEdit[] = [
    {
      id: '1', name: 'name1', type: DataType.string, value: 'aaa',
    },
    {
      id: '2.1', name: 'num v', type: DataType.number, value: 10,
    },
  ]
  const [addedList, setAddedList] = useState<MetadataItemWithEdit[]>(testAddedList)
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
    onSave([...templeList.filter(item => item.updateType !== UpdateType.delete), ...addedList], isApplyToAllSelectDocument)
  }, [templeList, addedList, isApplyToAllSelectDocument, onSave])
  return (
    <Modal
      title={t(`${i18nPrefix}.editMetadata`)}
      isShow
      closable
      onClose={onHide}
      className='!max-w-[640px]'
    >
      <div className='system-xs-medium text-text-accent'>{t(`${i18nPrefix}.editDocumentsNum`, { num: documentNum })}</div>
      {/* TODO handle list scroll. There is two list. */}
      <div className='mt-4 space-y-2'>
        {templeList.map(item => (
          <EditMetadataBatchItem
            key={item.id}
            payload={item}
            onChange={handleTemplesChange}
            onRemove={handleTempleItemRemove}
          />
        ))}
      </div>
      <div className='mt-4 pl-[18px]'>
        <div className='flex items-center'>
          <div className='mr-2 shrink-0 system-xs-medium-uppercase text-text-tertiary'>{t('dataset.metadata.createMetadata.title')}</div>
          <Divider bgStyle='gradient' />
        </div>
        <div className='mt-2 space-y-2'>
          {addedList.map((item, i) => (
            <AddedMetadataItem
              key={i}
              payload={item}
              onChange={handleAddedListChange}
              onRemove={handleAddedItemRemove(i)}
            />
          ))}
        </div>
        <div className='mt-3'>
          <SelectMetadataModal
            popupPlacement='top-start'
            popupOffset={{ mainAxis: 4, crossAxis: 0 }}
            trigger={
              <AddMetadataButton />
            }
            onSave={data => setAddedList([...addedList, data])}
          />
        </div>
      </div>

      <div className='mt-4 flex items-center justify-between'>
        <div className='flex items-center select-none'>
          <Checkbox checked={isApplyToAllSelectDocument} onCheck={() => setIsApplyToAllSelectDocument(!isApplyToAllSelectDocument)} />
          <div className='ml-2 mr-1 system-xs-medium text-text-secondary'>{t(`${i18nPrefix}.applyToAllSelectDocument`)}</div>
          <Tooltip popupContent={
            <div className='max-w-[240px]'>{t(`${i18nPrefix}.applyToAllSelectDocumentTip`)}</div>
          } >
            <div className='p-px cursor-pointer'>
              <RiQuestionLine className='size-3.5 text-text-tertiary' />
            </div>
          </Tooltip>
        </div>
        <div className='flex items-center space-x-2'>
          <Button
            onClick={onHide}>{t('common.operation.cancel')}</Button>
          <Button
            onClick={handleSave}
            variant='primary'
          >{t('common.operation.save')}</Button>
        </div>
      </div>
    </Modal>
  )
}
export default React.memo(EditMetadataBatchModal)
