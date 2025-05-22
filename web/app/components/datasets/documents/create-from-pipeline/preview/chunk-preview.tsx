import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PreviewContainer } from '../../../preview/container'
import { PreviewHeader } from '../../../preview/header'
import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { CrawlResultItem, CustomFile, DocumentItem, FileIndexingEstimateResponse } from '@/models/datasets'
import { ChunkingMode, DataSourceType } from '@/models/datasets'
import type { NotionPage } from '@/models/common'
import { DataSourceProvider } from '@/models/common'
import PreviewDocumentPicker from '../../../common/document-picker/preview-document-picker'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { ChunkContainer, QAPreview } from '../../../chunk'
import { FormattedText } from '../../../formatted-text/formatted'
import { PreviewSlice } from '../../../formatted-text/flavours/preview-slice'
import { SkeletonContainer, SkeletonPoint, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { RiSearchEyeLine } from '@remixicon/react'
import Badge from '@/app/components/base/badge'

type ChunkPreviewProps = {
  datasource: Datasource
  files: CustomFile[]
  notionPages: NotionPage[]
  websitePages: CrawlResultItem[]
  isIdle: boolean
  isPending: boolean
  estimateData: FileIndexingEstimateResponse | undefined
}

const ChunkPreview = ({
  datasource,
  files,
  notionPages,
  websitePages,
  isIdle,
  isPending,
  estimateData,
}: ChunkPreviewProps) => {
  const { t } = useTranslation()
  const currentDocForm = useDatasetDetailContextWithSelector(s => s.dataset?.doc_form)

  const [previewFile, setPreviewFile] = useState<DocumentItem>(files[0] as DocumentItem)
  const [previewNotionPage, setPreviewNotionPage] = useState<NotionPage>(notionPages[0])
  const [previewWebsitePage, setPreviewWebsitePage] = useState<CrawlResultItem>(websitePages[0])

  const dataSourceType = useMemo(() => {
    const type = datasource.type
    if (type === DataSourceProvider.fireCrawl || type === DataSourceProvider.jinaReader || type === DataSourceProvider.waterCrawl)
      return DataSourceType.WEB
    return type
  }, [datasource.type])

  return (
    <PreviewContainer
      header={<PreviewHeader
        title={t('datasetCreation.stepTwo.preview')}
      >
        <div className='flex items-center gap-1'>
          {dataSourceType === DataSourceType.FILE
            && <PreviewDocumentPicker
              files={files as Array<Required<CustomFile>>}
              onChange={(selected) => {
                setPreviewFile(selected)
              }}
              value={previewFile}
            />
          }
          {dataSourceType === DataSourceType.NOTION
            && <PreviewDocumentPicker
              files={
                notionPages.map(page => ({
                  id: page.page_id,
                  name: page.page_name,
                  extension: 'md',
                }))
              }
              onChange={(selected) => {
                const selectedPage = notionPages.find(page => page.page_id === selected.id)
                setPreviewNotionPage(selectedPage!)
              }}
              value={{
                id: previewNotionPage?.page_id || '',
                name: previewNotionPage?.page_name || '',
                extension: 'md',
              }}
            />
          }
          {dataSourceType === DataSourceType.WEB
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
          {
            currentDocForm !== ChunkingMode.qa
            && <Badge text={t('datasetCreation.stepTwo.previewChunkCount', {
              count: estimateData?.total_segments || 0,
            }) as string}
            />
          }
        </div>
      </PreviewHeader>}
      className='relative flex h-full w-1/2 shrink-0 p-4 pr-0'
      mainClassName='space-y-6'
    >
      {currentDocForm === ChunkingMode.qa && estimateData?.qa_preview && (
        estimateData?.qa_preview.map((item, index) => (
          <ChunkContainer
            key={item.question}
            label={`Chunk-${index + 1}`}
            characterCount={item.question.length + item.answer.length}
          >
            <QAPreview qa={item} />
          </ChunkContainer>
        ))
      )}
      {currentDocForm === ChunkingMode.text && estimateData?.preview && (
        estimateData?.preview.map((item, index) => (
          <ChunkContainer
            key={item.content}
            label={`Chunk-${index + 1}`}
            characterCount={item.content.length}
          >
            {item.content}
          </ChunkContainer>
        ))
      )}
      {currentDocForm === ChunkingMode.parentChild && estimateData?.preview && (
        estimateData?.preview?.map((item, index) => {
          const indexForLabel = index + 1
          // const childChunks = parentChildConfig.chunkForContext === 'full-doc'
          //   ? item.child_chunks.slice(0, FULL_DOC_PREVIEW_LENGTH)
          //   : item.child_chunks
          return (
            <ChunkContainer
              key={item.content}
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
      {!isIdle && (
        <div className='flex h-full w-full items-center justify-center'>
          <div className='flex flex-col items-center justify-center gap-3'>
            <RiSearchEyeLine className='size-10 text-text-empty-state-icon' />
            <p className='text-sm text-text-tertiary'>
              {t('datasetCreation.stepTwo.previewChunkTip')}
            </p>
          </div>
        </div>
      )}
      {isPending && (
        <div className='space-y-6'>
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
