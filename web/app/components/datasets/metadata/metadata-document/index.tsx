'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { DataType, type MetadataItemWithValue } from '../types'
import InfoGroup from './info-group'
import NoData from './no-data'
import Button from '@/app/components/base/button'
import { RiEditLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

const MetadataDocument: FC = () => {
  const { t } = useTranslation()
  const [isEdit, setIsEdit] = useState(false)

  const [list, setList] = useState<MetadataItemWithValue[]>([
    {
      id: '1',
      name: 'Doc type',
      value: 'PDF',
      type: DataType.string,
    },
    {
      id: '2',
      name: 'Title',
      value: 'PDF',
      type: DataType.string,
    },
  ])
  const [tempList, setTempList] = useState<MetadataItemWithValue[]>(list)
  const hasData = list.length > 0
  return (
    <div>
      {hasData ? (
        <InfoGroup
          title='Metadata'
          titleTooltip='Metadata serves as a critical filter that enhances the accuracy and relevance of information retrieval. You can modify and add metadata for this document here.'
          list={isEdit ? tempList : list}
          headerRight={isEdit ? (
            <div className='flex space-x-1'>
              <Button variant='ghost' size='small' onClick={() => {
                setTempList(list)
                setIsEdit(false)
              }}>
                <div>{t('common.operation.cancel')}</div>
              </Button>
              <Button variant='primary' size='small' onClick={() => {
                setIsEdit(false)
                setList(tempList)
              }}>
                <div>{t('common.operation.save')}</div>
              </Button>
            </div>
          ) : (
            <Button variant='ghost' size='small' onClick={() => {
              setTempList(list)
              setIsEdit(true)
            }}>
              <RiEditLine className='mr-1 size-3.5 text-text-tertiary cursor-pointer' />
              <div>{t('common.operation.edit')}</div>
            </Button>
          )}
          isEdit={isEdit}
          contentClassName='mt-5'
          onChange={(item) => {
            const newList = tempList.map(i => (i.name === item.name ? item : i))
            setList(newList)
          }}
          onDelete={(item) => {
            const newList = tempList.filter(i => i.name !== item.name)
            setList(newList)
          }}
          onAdd={() => {
          }}
        />

      ) : (
        <NoData onStart={() => { }} />
      )}
    </div>
  )
}

export default React.memo(MetadataDocument)
