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
  const hasData = list.length > 0
  return (
    <div>
      {hasData ? (
        <InfoGroup
          title='Metadata'
          titleTooltip='Metadata serves as a critical filter that enhances the accuracy and relevance of information retrieval. You can modify and add metadata for this document here.'
          list={list}
          headerRight={isEdit ? <div>Save</div> : <Button variant='ghost' onClick={() => setIsEdit(true)}>
            <RiEditLine className='size-3.5 text-text-tertiary cursor-pointer' />
            <div>{t('common.operation.edit')}</div>
          </Button>}
          isEdit={isEdit}
          onChange={(item) => {
            const newList = list.map(i => (i.name === item.name ? item : i))
            setList(newList)
          }}
          onDelete={(item) => {
            const newList = list.filter(i => i.name !== item.name)
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
