'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import useSWR from 'swr'
import { ArrowLeftIcon } from '@heroicons/react/24/solid'
import { createContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { omit } from 'lodash-es'
import cn from 'classnames'
import { OperationAction, StatusItem } from '../list'
import s from '../style.module.css'
import Completed from './completed'
import Embedding from './embedding'
import Metadata from './metadata'
import style from './style.module.css'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import type { MetadataType } from '@/service/datasets'
import { fetchDocumentDetail } from '@/service/datasets'

export const BackCircleBtn: FC<{ onClick: () => void }> = ({ onClick }) => {
  return (
    <div onClick={onClick} className={'rounded-full w-8 h-8 flex justify-center items-center border-gray-100 cursor-pointer border hover:border-gray-300 shadow-[0px_12px_16px_-4px_rgba(16,24,40,0.08),0px_4px_6px_-2px_rgba(16,24,40,0.03)]'}>
      <ArrowLeftIcon className='text-primary-600 fill-current stroke-current h-4 w-4' />
    </div>
  )
}

export const DocumentContext = createContext<{ datasetId?: string; documentId?: string }>({})

type DocumentTitleProps = {
  extension?: string
  name?: string
  iconCls?: string
  textCls?: string
  wrapperCls?: string
}

export const DocumentTitle: FC<DocumentTitleProps> = ({ extension, name, iconCls, textCls, wrapperCls }) => {
  const localExtension = extension?.toLowerCase() || name?.split('.')?.pop()?.toLowerCase()
  return <div className={cn('flex items-center justify-start flex-1', wrapperCls)}>
    <div className={cn(s[`${localExtension || 'txt'}Icon`], style.titleIcon, iconCls)}></div>
    <span className={cn('font-semibold text-lg text-gray-900 ml-1', textCls)}> {name || '--'}</span>
  </div>
}

type Props = {
  datasetId: string
  documentId: string
}

const DocumentDetail: FC<Props> = ({ datasetId, documentId }) => {
  const { t } = useTranslation()
  const router = useRouter()
  const [showMetadata, setShowMetadata] = useState(true)

  const { data: documentDetail, error, mutate: detailMutate } = useSWR({
    action: 'fetchDocumentDetail',
    datasetId,
    documentId,
    params: { metadata: 'without' as MetadataType },
  }, apiParams => fetchDocumentDetail(omit(apiParams, 'action')))

  const { data: documentMetadata, error: metadataErr, mutate: metadataMutate } = useSWR({
    action: 'fetchDocumentDetail',
    datasetId,
    documentId,
    params: { metadata: 'only' as MetadataType },
  }, apiParams => fetchDocumentDetail(omit(apiParams, 'action')),
  )

  const backToPrev = () => {
    router.push(`/datasets/${datasetId}/documents`)
  }

  const isDetailLoading = !documentDetail && !error
  const isMetadataLoading = !documentMetadata && !metadataErr

  const embedding = ['queuing', 'indexing', 'paused'].includes((documentDetail?.display_status || '').toLowerCase())

  const handleOperate = (operateName?: string) => {
    if (operateName === 'delete')
      backToPrev()
    else
      detailMutate()
  }

  return (
    <DocumentContext.Provider value={{ datasetId, documentId }}>
      <div className='flex flex-col h-full'>
        <div className='flex h-16 border-b-gray-100 border-b items-center p-4'>
          <BackCircleBtn onClick={backToPrev} />
          <Divider className='!h-4' type='vertical' />
          <DocumentTitle extension={documentDetail?.data_source_info?.upload_file?.extension} name={documentDetail?.name} />
          <StatusItem status={documentDetail?.display_status || 'available'} scene='detail' />
          <OperationAction
            scene='detail'
            detail={{
              enabled: documentDetail?.enabled || false,
              archived: documentDetail?.archived || false,
              id: documentId,
            }}
            datasetId={datasetId}
            onUpdate={handleOperate}
            className='!w-[216px]'
          />
          <button
            className={cn(style.layoutRightIcon, showMetadata ? style.iconShow : style.iconClose)}
            onClick={() => setShowMetadata(!showMetadata)}
          />
        </div>
        <div className='flex flex-row flex-1' style={{ height: 'calc(100% - 4rem)' }}>
          {isDetailLoading
            ? <Loading type='app' />
            : <div className={`box-border h-full w-full overflow-y-scroll ${embedding ? 'py-12 px-16' : 'pb-[30px] pt-3 px-6'}`}>
              {embedding ? <Embedding detail={documentDetail} /> : <Completed />}
            </div>
          }
          {showMetadata && <Metadata
            docDetail={{ ...documentDetail, ...documentMetadata } as any}
            loading={isMetadataLoading}
            onUpdate={metadataMutate}
          />}
        </div>
      </div>
    </DocumentContext.Provider>
  )
}

export default DocumentDetail
