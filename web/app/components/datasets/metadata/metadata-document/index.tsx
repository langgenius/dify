'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { DataType, type MetadataItemWithValue } from '../types'
import InfoGroup from './info-group'
import NoData from './no-data'
import Button from '@/app/components/base/button'
import { RiEditLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'

const i18nPrefix = 'dataset.metadata.documentMetadata'

const MetadataDocument: FC = () => {
  const { t } = useTranslation()
  const [isEdit, setIsEdit] = useState(true)

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
  const builtInEnabled = true
  const builtList = [
    {
      id: '1',
      name: 'OriginalfileNmae',
      value: 'Steve Jobs The Man Who Thought Different.pdf',
      type: DataType.string,
    },
    {
      id: '2',
      name: 'Title',
      value: 'PDF',
      type: DataType.string,
    },
  ]
  const hasData = list.length > 0

  const documentInfoList = builtList
  const technicalParams = builtList
  return (
    <div className='w-[388px] space-y-4'>
      {!hasData ? (
        <div>
          <InfoGroup
            title={t('dataset.metadata.metadata')}
            uppercaseTitle={false}
            titleTooltip={t(`${i18nPrefix}.metadataToolTip`)}
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
          {builtInEnabled && (
            <>
              <Divider className='my-3' bgStyle='gradient' />
              <InfoGroup
                noHeader
                titleTooltip='Built-in metadata is system-generated metadata that is automatically added to the document. You can enable or disable built-in metadata here.'
                list={builtList}
              />
            </>
          )}
        </div>
      ) : (
        <NoData onStart={() => { }} />
      )}

      <InfoGroup
        title={t(`${i18nPrefix}.documentInformation`)}
        list={documentInfoList}
      />
      <InfoGroup
        title={t(`${i18nPrefix}.technicalParameters`)}
        list={technicalParams}
      />
    </div>
  )
}

export default React.memo(MetadataDocument)
