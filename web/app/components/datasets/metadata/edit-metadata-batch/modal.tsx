'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import Modal from '../../../base/modal'
import { DataType, type MetadataItemWithEdit } from '../types'
import EditMetadataBatchItem from './edit-row'
import AddedMetadataItem from './add-row'
import Button from '../../../base/button'
import { useTranslation } from 'react-i18next'
import Checkbox from '../../../base/checkbox'
import Tooltip from '../../../base/tooltip'
import SelectMetadataModal from '../select-metadata-modal'
import { RiQuestionLine } from '@remixicon/react'
import Divider from '@/app/components/base/divider'
import AddMetadataButton from '../add-metadata-button'

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
      <div className='mt-4 pl-[18px]'>
        <div className='flex items-center'>
          <div className='mr-2 shrink-0 system-xs-medium-uppercase text-text-tertiary'>New metadata</div>
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
        <div className='flex items-center'>
          <Checkbox checked={isApplyToAllSelectDocument} onCheck={() => setIsApplyToAllSelectDocument(!isApplyToAllSelectDocument)} />
          <div className='ml-2 mr-1 system-xs-medium text-text-secondary'>Apply to all selected documents</div>
          <Tooltip popupContent={
            <div className='max-w-[240px]'>Automatically create all the above edited and new metadata for all selected documents, otherwise editing metadata will only apply to documents with it.</div>
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
