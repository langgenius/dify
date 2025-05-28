'use client'
import type { FC } from 'react'
import React from 'react'
import InfoGroup from './info-group'
import NoData from './no-data'
import Button from '@/app/components/base/button'
import { RiEditLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import useMetadataDocument from '../hooks/use-metadata-document'
import type { FullDocumentDetail } from '@/models/datasets'
import cn from '@/utils/classnames'

const i18nPrefix = 'dataset.metadata.documentMetadata'

type Props = {
  datasetId: string
  documentId: string
  className?: string
  docDetail: FullDocumentDetail
}
const MetadataDocument: FC<Props> = ({
  datasetId,
  documentId,
  className,
  docDetail,
}) => {
  const { t } = useTranslation()

  const {
    embeddingAvailable,
    isEdit,
    setIsEdit,
    list,
    tempList,
    setTempList,
    handleSelectMetaData,
    handleAddMetaData,
    hasData,
    builtList,
    builtInEnabled,
    startToEdit,
    handleSave,
    handleCancel,
    originInfo,
    technicalParameters,
  } = useMetadataDocument({ datasetId, documentId, docDetail })

  return (
    <div className={cn('w-[388px] space-y-4', className)}>
      {(hasData || isEdit) ? (
        <div className='pl-2'>
          <InfoGroup
            title={t('dataset.metadata.metadata')}
            uppercaseTitle={false}
            titleTooltip={t(`${i18nPrefix}.metadataToolTip`)}
            list={isEdit ? tempList : list}
            dataSetId={datasetId}
            headerRight={embeddingAvailable && (isEdit ? (
              <div className='flex space-x-1'>
                <Button variant='ghost' size='small' onClick={handleCancel}>
                  <div>{t('common.operation.cancel')}</div>
                </Button>
                <Button variant='primary' size='small' onClick={handleSave}>
                  <div>{t('common.operation.save')}</div>
                </Button>
              </div>
            ) : (
              <Button variant='ghost' size='small' onClick={startToEdit}>
                <RiEditLine className='mr-1 size-3.5 cursor-pointer text-text-tertiary' />
                <div>{t('common.operation.edit')}</div>
              </Button>
            ))}
            isEdit={isEdit}
            contentClassName='mt-5'
            onChange={(item) => {
              const newList = tempList.map(i => (i.name === item.name ? item : i))
              setTempList(newList)
            }}
            onDelete={(item) => {
              const newList = tempList.filter(i => i.name !== item.name)
              setTempList(newList)
            }}
            onAdd={handleAddMetaData}
            onSelect={handleSelectMetaData}
          />
        </div>
      ) : (
        embeddingAvailable && <NoData onStart={() => setIsEdit(true)} />
      )}
      {builtInEnabled && (
        <div className='pl-2'>
          <Divider className='my-3' bgStyle='gradient' />
          <InfoGroup
            noHeader
            titleTooltip='Built-in metadata is system-generated metadata that is automatically added to the document. You can enable or disable built-in metadata here.'
            list={builtList}
            dataSetId={datasetId}
          />
        </div>
      )}

      {/* Old Metadata */}
      <InfoGroup
        className='pl-2'
        title={t(`${i18nPrefix}.documentInformation`)}
        list={originInfo}
        dataSetId={datasetId}
      />
      <InfoGroup
        className='pl-2'
        title={t(`${i18nPrefix}.technicalParameters`)}
        list={technicalParameters}
        dataSetId={datasetId}
      />
    </div>
  )
}

export default React.memo(MetadataDocument)
