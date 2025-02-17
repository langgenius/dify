'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import Modal from '../../../base/modal'
import type { MetadataItemWithEdit } from '../types'
import EditMetadataBatchItem, { AddedMetadataItem } from './edit-row'
import Button from '../../../base/button'
import { useTranslation } from 'react-i18next'
import Checkbox from '../../../base/checkbox'
import Tooltip from '../../../base/tooltip'

type Props = {
  documentNum: number
  list: MetadataItemWithEdit[]
  onChange: (list: MetadataItemWithEdit[], addedList: MetadataItemWithEdit[], isApplyToAllSelectDocument: boolean) => void
  onHide: () => void
}

const EditMetadataBatchModal: FC<Props> = ({
  documentNum,
  list,
  onChange,
  onHide,
}) => {
  const { t } = useTranslation()
  const [templeList, setTempleList] = useState<MetadataItemWithEdit[]>(list)
  const handleTemplesChange = useCallback((payload: MetadataItemWithEdit) => {
    const newTempleList = templeList.map(i => i.id === payload.id ? payload : i)
    setTempleList(newTempleList)
  }, [templeList])
  const handleTempleItemRemove = useCallback((id: string) => {
    const newTempleList = templeList.filter(i => i.id !== id)
    setTempleList(newTempleList)
  }, [templeList])

  const [addedList, setAddedList] = useState<MetadataItemWithEdit[]>([])
  const handleAddedListChange = useCallback((payload: MetadataItemWithEdit) => {
    const newAddedList = addedList.map(i => i.id === payload.id ? payload : i)
    setAddedList(newAddedList)
  }, [addedList])
  const handleAddedItemRemove = useCallback((id: string) => {
    const newAddedList = addedList.filter(i => i.id !== id)
    setAddedList(newAddedList)
  }, [addedList])

  const [isApplyToAllSelectDocument, setIsApplyToAllSelectDocument] = useState(false)

  const handleSave = useCallback(() => {
    onChange(templeList, addedList, isApplyToAllSelectDocument)
  }, [templeList, addedList, isApplyToAllSelectDocument, onChange])
  return (
    <Modal
      title='Edit Metadata'
      isShow
      closable
      onClose={onHide}
      className='!max-w-[640px]'
    >
      <div className='system-xs-medium text-text-accent'>Editing {documentNum} documents</div>
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

      <div>
        {addedList.map(item => (
          <AddedMetadataItem
            key={item.id}
            payload={item}
            onChange={handleAddedListChange}
            onRemove={handleAddedItemRemove}
          />
        ))}
      </div>

      <div className='mt-4 flex items-center justify-between'>
        <div className='flex items-center'>
          <Checkbox checked={isApplyToAllSelectDocument} onCheck={() => setIsApplyToAllSelectDocument(!isApplyToAllSelectDocument)} />
          <div className='ml-2 mr-1'> Apply to all selected documents</div>
          <Tooltip popupContent={
            <div className='max-w-[240px]'>Automatically create all the above edited and new metadata for all selected documents, otherwise editing metadata will only apply to documents with it.</div>
          } />
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
