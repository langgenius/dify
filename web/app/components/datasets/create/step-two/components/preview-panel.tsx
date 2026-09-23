'use client'

import type { ComponentProps, FC } from 'react'
import type { ParentChildConfig } from '../hooks'
import type { DataSourceType, FileIndexingEstimateResponse } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { RiSearchEyeLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import FloatRightContainer from '@/app/components/base/float-right-container'
import {
  SkeletonContainer,
  SkeletonPoint,
  SkeletonRectangle,
  SkeletonRow,
} from '@/app/components/base/skeleton'
import { FULL_DOC_PREVIEW_LENGTH } from '@/config'
import { ChunkingMode } from '@/models/datasets'
import { ChunkContainer, QAPreview } from '../../../chunk'
import PreviewDocumentPicker from '../../../common/document-picker/preview-document-picker'
import SummaryLabel from '../../../documents/detail/completed/common/summary-label'
import { PreviewSlice } from '../../../formatted-text/flavours/preview-slice'
import { FormattedText } from '../../../formatted-text/formatted'
import PreviewContainer from '../../../preview/container'

type PreviewPanelProps = {
  // State
  isMobile: boolean
  isOpen: boolean
  onClose: () => void
  finalFocus?: ComponentProps<typeof FloatRightContainer>['finalFocus']
  dataSourceType: DataSourceType
  currentDocForm: ChunkingMode
  estimate?: FileIndexingEstimateResponse
  parentChildConfig: ParentChildConfig
  isSetting?: boolean
  // Picker
  pickerFiles: Array<{ id: string; name: string; extension: string }>
  pickerValue: { id: string; name: string; extension: string }
  // Mutation state
  isIdle: boolean
  isPending: boolean
  // Actions
  onPickerChange: (selected: { id: string; name: string }) => void
}

export const PreviewPanel: FC<PreviewPanelProps> = ({
  isMobile,
  isOpen,
  onClose,
  finalFocus,
  dataSourceType: _dataSourceType,
  currentDocForm,
  estimate,
  parentChildConfig,
  isSetting,
  pickerFiles,
  pickerValue,
  isIdle,
  isPending,
  onPickerChange,
}) => {
  const { t } = useTranslation()

  return (
    <FloatRightContainer
      isMobile={isMobile}
      isOpen={!isMobile || isOpen}
      onClose={onClose}
      showClose
      title={t(($) => $['stepTwo.preview'], { ns: 'datasetCreation' })}
      finalFocus={finalFocus}
    >
      <div role="status" aria-atomic="true" className="sr-only">
        {isPending
          ? t(($) => $.loading, { ns: 'common' })
          : estimate
            ? t(($) => $['stepTwo.previewChunkCount'], {
                ns: 'datasetCreation',
                count: estimate.total_segments ?? estimate.qa_preview?.length ?? 0,
              })
            : ''}
      </div>
      <PreviewContainer
        header={
          <div>
            {!isMobile && (
              <h2 className="mb-1 px-1 system-2xs-semibold-uppercase text-text-accent uppercase">
                {t(($) => $['stepTwo.preview'], { ns: 'datasetCreation' })}
              </h2>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <PreviewDocumentPicker
                files={
                  pickerFiles as Array<Required<{ id: string; name: string; extension: string }>>
                }
                onChange={onPickerChange}
                value={isSetting ? pickerFiles[0] : pickerValue}
              />
              {currentDocForm !== ChunkingMode.qa && (
                <Badge>
                  {t(($) => $['stepTwo.previewChunkCount'], {
                    ns: 'datasetCreation',
                    count: estimate?.total_segments || 0,
                  })}
                </Badge>
              )}
            </div>
          </div>
        }
        className={cn(
          'relative flex min-w-0 shrink-0 p-4',
          isMobile ? 'min-h-0 w-full flex-1' : 'h-full w-1/2 pr-0',
        )}
        mainClassName="space-y-6 wrap-break-word"
      >
        {/* QA Preview */}
        {currentDocForm === ChunkingMode.qa &&
          estimate?.qa_preview &&
          estimate.qa_preview.map((item, index) => (
            <ChunkContainer
              key={item.question}
              label={`Chunk-${index + 1}`}
              characterCount={item.question.length + item.answer.length}
            >
              <QAPreview qa={item} />
            </ChunkContainer>
          ))}

        {/* Text Preview */}
        {currentDocForm === ChunkingMode.text &&
          estimate?.preview &&
          estimate.preview.map((item, index) => (
            <ChunkContainer
              key={item.content}
              label={`Chunk-${index + 1}`}
              characterCount={item.content.length}
            >
              {item.content}
              {item.summary && <SummaryLabel summary={item.summary} />}
            </ChunkContainer>
          ))}

        {/* Parent-Child Preview */}
        {currentDocForm === ChunkingMode.parentChild &&
          estimate?.preview &&
          estimate.preview.map((item, index) => {
            const indexForLabel = index + 1
            const childChunks =
              parentChildConfig.chunkForContext === 'full-doc'
                ? item.child_chunks.slice(0, FULL_DOC_PREVIEW_LENGTH)
                : item.child_chunks
            return (
              <ChunkContainer
                key={item.content}
                label={`Chunk-${indexForLabel}`}
                characterCount={item.content.length}
              >
                <FormattedText>
                  {childChunks.map((child, childIndex) => {
                    const childIndexForLabel = childIndex + 1
                    return (
                      <PreviewSlice
                        key={`C-${childIndexForLabel}-${child}`}
                        label={`C-${childIndexForLabel}`}
                        text={child}
                        tooltip={`Child-chunk-${childIndexForLabel} · ${child.length} Characters`}
                        labelInnerClassName="text-[10px] font-semibold align-bottom leading-7"
                        dividerClassName="leading-7"
                      />
                    )
                  })}
                </FormattedText>
                {item.summary && <SummaryLabel summary={item.summary} />}
              </ChunkContainer>
            )
          })}

        {/* Idle State */}
        {isIdle && (
          <div className="flex size-full items-center justify-center">
            <div className="flex flex-col items-center justify-center gap-3">
              <RiSearchEyeLine className="size-10 text-text-empty-state-icon" />
              <p className="text-sm text-text-tertiary">
                {t(($) => $['stepTwo.previewChunkTip'], { ns: 'datasetCreation' })}
              </p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isPending && (
          <div className="space-y-6">
            {Array.from({ length: 10 }, (_, i) => (
              <SkeletonContainer key={i}>
                <SkeletonRow>
                  <SkeletonRectangle className="w-20" />
                  <SkeletonPoint />
                  <SkeletonRectangle className="w-24" />
                </SkeletonRow>
                <SkeletonRectangle className="w-full" />
                <SkeletonRectangle className="w-full" />
                <SkeletonRectangle className="w-full max-w-105.5" />
              </SkeletonContainer>
            ))}
          </div>
        )}
      </PreviewContainer>
    </FloatRightContainer>
  )
}
