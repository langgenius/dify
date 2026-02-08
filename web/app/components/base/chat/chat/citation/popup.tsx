import type { FC, MouseEvent } from 'react'
import type { Resources } from './index'
import Link from 'next/link'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import FileIcon from '@/app/components/base/file-icon'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'
import {
  BezierCurve03,
  TypeSquare,
} from '@/app/components/base/icons/src/vender/line/editor'
import {
  Hash02,
  Target04,
} from '@/app/components/base/icons/src/vender/line/general'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useDocumentDownload } from '@/service/knowledge/use-document'
import { downloadUrl } from '@/utils/download'
import ProgressTooltip from './progress-tooltip'
import Tooltip from './tooltip'

type PopupProps = {
  data: Resources
  showHitInfo?: boolean
}

const Popup: FC<PopupProps> = ({
  data,
  showHitInfo = false,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const fileType = data.dataSourceType !== 'notion'
    ? (/\.([^.]*)$/.exec(data.documentName)?.[1] || '')
    : 'notion'

  const { mutateAsync: downloadDocument, isPending: isDownloading } = useDocumentDownload()

  /**
   * Download the original uploaded file for citations whose data source is upload-file.
   * We request a signed URL from the dataset document download endpoint, then trigger browser download.
   */
  const handleDownloadUploadFile = async (e: MouseEvent<HTMLElement>) => {
    // Prevent toggling the citation popup when user clicks the download link.
    e.preventDefault()
    e.stopPropagation()

    // Only upload-file citations can be downloaded this way (needs dataset/document ids).
    const isUploadFile = data.dataSourceType === 'upload_file' || data.dataSourceType === 'file'
    const datasetId = data.sources?.[0]?.dataset_id
    const documentId = data.documentId || data.sources?.[0]?.document_id
    if (!isUploadFile || !datasetId || !documentId || isDownloading)
      return

    // Fetch signed URL (usually points to `/files/<id>/file-preview?...&as_attachment=true`).
    const res = await downloadDocument({ datasetId, documentId })
    if (res?.url)
      downloadUrl({ url: res.url, fileName: data.documentName })
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="top-start"
      offset={{
        mainAxis: 8,
        crossAxis: -2,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className="flex h-7 max-w-[240px] items-center rounded-lg bg-components-button-secondary-bg px-2">
          <FileIcon type={fileType} className="mr-1 h-4 w-4 shrink-0" />
          {/* Keep the trigger purely for opening the popup (no download link here). */}
          <div className="truncate text-xs text-text-tertiary">{data.documentName}</div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1000 }}>
        <div className="max-w-[360px] rounded-xl bg-background-section-burn shadow-lg backdrop-blur-[5px]">
          <div className="px-4 pb-2 pt-3">
            <div className="flex h-[18px] items-center">
              <FileIcon type={fileType} className="mr-1 h-4 w-4 shrink-0" />
              <div className="system-xs-medium truncate text-text-tertiary">
                {/* If it's an upload-file reference, the title becomes a download link. */}
                {(data.dataSourceType === 'upload_file' || data.dataSourceType === 'file') && !!data.sources?.[0]?.dataset_id
                  ? (
                      <button
                        type="button"
                        className="cursor-pointer truncate text-text-tertiary hover:underline"
                        onClick={handleDownloadUploadFile}
                        disabled={isDownloading}
                      >
                        {data.documentName}
                      </button>
                    )
                  : data.documentName}
              </div>
            </div>
          </div>
          <div className="max-h-[450px] overflow-y-auto rounded-lg bg-components-panel-bg px-4 py-0.5">
            <div className="w-full">
              {
                data.sources.map((source, index) => (
                  <Fragment key={index}>
                    <div className="group py-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex h-5 items-center rounded-md border border-divider-subtle px-1.5">
                          <Hash02 className="mr-0.5 h-3 w-3 text-text-quaternary" />
                          <div className="text-[11px] font-medium text-text-tertiary">
                            {source.segment_position || index + 1}
                          </div>
                        </div>
                        {
                          showHitInfo && (
                            <Link
                              href={`/datasets/${source.dataset_id}/documents/${source.document_id}`}
                              className="hidden h-[18px] items-center text-xs text-text-accent group-hover:flex"
                            >
                              {t('chat.citation.linkToDataset', { ns: 'common' })}
                              <ArrowUpRight className="ml-1 h-3 w-3" />
                            </Link>
                          )
                        }
                      </div>
                      <div className="break-words text-[13px] text-text-secondary">{source.content}</div>
                      {
                        showHitInfo && (
                          <div className="system-xs-medium mt-2 flex flex-wrap items-center text-text-quaternary">
                            <Tooltip
                              text={t('chat.citation.characters', { ns: 'common' })}
                              data={source.word_count}
                              icon={<TypeSquare className="mr-1 h-3 w-3" />}
                            />
                            <Tooltip
                              text={t('chat.citation.hitCount', { ns: 'common' })}
                              data={source.hit_count}
                              icon={<Target04 className="mr-1 h-3 w-3" />}
                            />
                            <Tooltip
                              text={t('chat.citation.vectorHash', { ns: 'common' })}
                              data={source.index_node_hash?.substring(0, 7)}
                              icon={<BezierCurve03 className="mr-1 h-3 w-3" />}
                            />
                            {
                              !!source.score && (
                                <ProgressTooltip data={Number(source.score.toFixed(2))} />
                              )
                            }
                          </div>
                        )
                      }
                    </div>
                    {
                      index !== data.sources.length - 1 && (
                        <div className="my-1 h-px bg-divider-regular" />
                      )
                    }
                  </Fragment>
                ))
              }
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Popup
