import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import PreviewContainer from '../../../preview/container'
import { PreviewHeader } from '../../../preview/header'
import type { CrawlResultItem, CustomFile, DocumentItem, FileIndexingEstimateResponse } from '@/models/datasets'
import { ChunkingMode } from '@/models/datasets'
import type { NotionPage } from '@/models/common'
import PreviewDocumentPicker from '../../../common/document-picker/preview-document-picker'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { ChunkContainer, QAPreview } from '../../../chunk'
import { FormattedText } from '../../../formatted-text/formatted'
import { PreviewSlice } from '../../../formatted-text/flavours/preview-slice'
import { SkeletonContainer, SkeletonPoint, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { RiSearchEyeLine } from '@remixicon/react'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import type { OnlineDriveFile } from '@/models/pipeline'
import { DatasourceType } from '@/models/pipeline'
import { getFileExtension } from '../data-source/online-drive/file-list/list/utils'

type ChunkPreviewProps = {
  dataSourceType: DatasourceType
  localFiles: CustomFile[]
  onlineDocuments: NotionPage[]
  websitePages: CrawlResultItem[]
  onlineDriveFiles: OnlineDriveFile[]
  isIdle: boolean
  isPending: boolean
  estimateData: FileIndexingEstimateResponse | undefined
  onPreview: () => void
  handlePreviewFileChange: (file: DocumentItem) => void
  handlePreviewOnlineDocumentChange: (page: NotionPage) => void
  handlePreviewWebsitePageChange: (page: CrawlResultItem) => void
  handlePreviewOnlineDriveFileChange: (file: OnlineDriveFile) => void
}

const ChunkPreview = ({
  dataSourceType,
  localFiles,
  onlineDocuments,
  websitePages,
  onlineDriveFiles,
  isIdle,
  isPending,
  estimateData,
  onPreview,
  handlePreviewFileChange,
  handlePreviewOnlineDocumentChange,
  handlePreviewWebsitePageChange,
  handlePreviewOnlineDriveFileChange,
}: ChunkPreviewProps) => {
  const { t } = useTranslation()
  const currentDocForm = useDatasetDetailContextWithSelector(s => s.dataset?.doc_form)

  const [previewFile, setPreviewFile] = useState<DocumentItem>(localFiles[0] as DocumentItem)
  const [previewOnlineDocument, setPreviewOnlineDocument] = useState<NotionPage>(onlineDocuments[0])
  const [previewWebsitePage, setPreviewWebsitePage] = useState<CrawlResultItem>(websitePages[0])
  const [previewOnlineDriveFile, setPreviewOnlineDriveFile] = useState<OnlineDriveFile>(onlineDriveFiles[0])

  return (
    <PreviewContainer
      header={<PreviewHeader
        title={t('datasetCreation.stepTwo.preview')}
      >
        <div className='flex items-center gap-1'>
          {dataSourceType === DatasourceType.localFile
            && <PreviewDocumentPicker
              files={localFiles as Array<Required<CustomFile>>}
              onChange={(selected) => {
                setPreviewFile(selected)
                handlePreviewFileChange(selected)
              }}
              value={previewFile}
            />
          }
          {dataSourceType === DatasourceType.onlineDocument
            && <PreviewDocumentPicker
              files={
                onlineDocuments.map(page => ({
                  id: page.page_id,
                  name: page.page_name,
                  extension: 'md',
                }))
              }
              onChange={(selected) => {
                const selectedPage = onlineDocuments.find(page => page.page_id === selected.id)
                setPreviewOnlineDocument(selectedPage!)
                handlePreviewOnlineDocumentChange(selectedPage!)
              }}
              value={{
                id: previewOnlineDocument?.page_id || '',
                name: previewOnlineDocument?.page_name || '',
                extension: 'md',
              }}
            />
          }
          {dataSourceType === DatasourceType.websiteCrawl
            && <PreviewDocumentPicker
              files={
                websitePages.map(page => ({
                  id: page.source_url,
                  name: page.title,
                  extension: 'md',
                }))
              }
              onChange={(selected) => {
                const selectedPage = websitePages.find(page => page.source_url === selected.id)
                setPreviewWebsitePage(selectedPage!)
                handlePreviewWebsitePageChange(selectedPage!)
              }}
              value={
                {
                  id: previewWebsitePage?.source_url || '',
                  name: previewWebsitePage?.title || '',
                  extension: 'md',
                }
              }
            />
          }
          {dataSourceType === DatasourceType.onlineDrive
            && <PreviewDocumentPicker
              files={
                onlineDriveFiles.map(file => ({
                  id: file.id,
                  name: file.name,
                  extension: getFileExtension(previewOnlineDriveFile?.name),
                }))
              }
              onChange={(selected) => {
                const selectedFile = onlineDriveFiles.find(file => file.id === selected.id)
                setPreviewOnlineDriveFile(selectedFile!)
                handlePreviewOnlineDriveFileChange(selectedFile!)
              }}
              value={
                {
                  id: previewOnlineDriveFile?.id || '',
                  name: previewOnlineDriveFile?.name || '',
                  extension: getFileExtension(previewOnlineDriveFile?.name),
                }
              }
            />
          }
          {
            currentDocForm !== ChunkingMode.qa
            && <Badge text={t('datasetCreation.stepTwo.previewChunkCount', {
              count: estimateData?.total_segments || 0,
            }) as string}
            />
          }
        </div>
      </PreviewHeader>}
      className='relative flex h-full w-full shrink-0'
      mainClassName='space-y-6'
    >
      {!isPending && currentDocForm === ChunkingMode.qa && estimateData?.qa_preview && (
        estimateData?.qa_preview.map((item, index) => (
          <ChunkContainer
            key={`${item.question}-${index}`}
            label={`Chunk-${index + 1}`}
            characterCount={item.question.length + item.answer.length}
          >
            <QAPreview qa={item} />
          </ChunkContainer>
        ))
      )}
      {!isPending && currentDocForm === ChunkingMode.text && estimateData?.preview && (
        estimateData?.preview.map((item, index) => (
          <ChunkContainer
            key={`${item.content}-${index}`}
            label={`Chunk-${index + 1}`}
            characterCount={item.content.length}
          >
            {item.content}
          </ChunkContainer>
        ))
      )}
      {!isPending && currentDocForm === ChunkingMode.parentChild && estimateData?.preview && (
        estimateData?.preview?.map((item, index) => {
          const indexForLabel = index + 1
          return (
            <ChunkContainer
              key={`${item.content}-${index}`}
              label={`Chunk-${indexForLabel}`}
              characterCount={item.content.length}
            >
              <FormattedText>
                {item.child_chunks.map((child, index) => {
                  const indexForLabel = index + 1
                  return (
                    <PreviewSlice
                      key={child}
                      label={`C-${indexForLabel}`}
                      text={child}
                      tooltip={`Child-chunk-${indexForLabel} · ${child.length} Characters`}
                      labelInnerClassName='text-[10px] font-semibold align-bottom leading-7'
                      dividerClassName='leading-7'
                    />
                  )
                })}
              </FormattedText>
            </ChunkContainer>
          )
        })
      )}
      {isIdle && (
        <div className='flex h-full w-full items-center justify-center'>
          <div className='flex flex-col items-center justify-center gap-3 pb-4'>
            <RiSearchEyeLine className='size-10 text-text-empty-state-icon' />
            <p className='text-sm text-text-tertiary'>
              {t('datasetCreation.stepTwo.previewChunkTip')}
            </p>
            <Button onClick={onPreview}>
              {t('datasetPipeline.addDocuments.stepTwo.previewChunks')}
            </Button>
          </div>
        </div>
      )}
      {isPending && (
        <div className='h-full w-full space-y-6 overflow-hidden'>
          {Array.from({ length: 10 }, (_, i) => (
            <SkeletonContainer key={i}>
              <SkeletonRow>
                <SkeletonRectangle className='w-20' />
                <SkeletonPoint />
                <SkeletonRectangle className='w-24' />
              </SkeletonRow>
              <SkeletonRectangle className='w-full' />
              <SkeletonRectangle className='w-full' />
              <SkeletonRectangle className='w-[422px]' />
            </SkeletonContainer>
          ))}
        </div>
      )}
    </PreviewContainer>
  )
}

export default React.memo(ChunkPreview)
