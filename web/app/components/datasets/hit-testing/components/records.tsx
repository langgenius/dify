import type { Attachment, HitTestingRecord, Query } from '@/models/datasets'
import { RiApps2Line, RiArrowDownLine, RiFocus2Line } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'
import { cn } from '@/utils/classnames'
import ImageList from '../../common/image-list'

type RecordsProps = {
  records: HitTestingRecord[]
  onClickRecord: (record: HitTestingRecord) => void
}

const Records = ({
  records,
  onClickRecord,
}: RecordsProps) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()

  const [sortTimeOrder, setTimeOrder] = useState<'asc' | 'desc'>('desc')

  const handleSortTime = useCallback(() => {
    setTimeOrder(prev => prev === 'asc' ? 'desc' : 'asc')
  }, [])

  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => {
      return sortTimeOrder === 'asc' ? a.created_at - b.created_at : b.created_at - a.created_at
    })
  }, [records, sortTimeOrder])

  const getImageList = (queries: Query[]) => {
    const imageQueries = queries
      .filter(query => query.content_type === 'image_query')
      .map(query => query.file_info)
      .filter(Boolean) as Attachment[]
    return imageQueries.map(image => ({
      name: image.name,
      mimeType: image.mime_type,
      sourceUrl: image.source_url,
      size: image.size,
      extension: image.extension,
    }))
  }

  return (
    <div className="grow overflow-y-auto">
      <table className="w-full border-collapse border-0 text-[13px] leading-4 text-text-secondary ">
        <thead className="sticky top-0 h-7 text-xs  font-medium uppercase leading-7 text-text-tertiary backdrop-blur-[5px]">
          <tr>
            <td className="rounded-l-lg bg-background-section-burn pl-3">{t('table.header.queryContent', { ns: 'datasetHitTesting' })}</td>
            <td className="w-[128px]  bg-background-section-burn pl-3">{t('table.header.source', { ns: 'datasetHitTesting' })}</td>
            <td className="w-48 rounded-r-lg bg-background-section-burn pl-3">
              <div
                className="flex cursor-pointer items-center"
                onClick={handleSortTime}
              >
                {t('table.header.time', { ns: 'datasetHitTesting' })}
                <RiArrowDownLine
                  className={cn(
                    'ml-0.5 size-3.5',
                    sortTimeOrder === 'asc' ? 'rotate-180' : '',
                  )}
                />
              </div>
            </td>
          </tr>
        </thead>
        <tbody>
          {sortedRecords.map((record) => {
            const { id, source, created_at, queries } = record
            const SourceIcon = record.source === 'app' ? RiApps2Line : RiFocus2Line
            const content = queries.find(query => query.content_type === 'text_query')?.content || ''
            const images = getImageList(queries)
            return (
              <tr
                key={id}
                className="group cursor-pointer border-b border-divider-subtle hover:bg-background-default-hover"
                onClick={() => onClickRecord(record)}
              >
                <td className="max-w-xs p-3 pr-2">
                  <div className="flex flex-col gap-y-1">
                    {content && (
                      <div className="line-clamp-2">
                        {content}
                      </div>
                    )}
                    {images.length > 0 && (
                      <ImageList
                        images={images}
                        size="md"
                        className="py-1"
                        limit={5}
                      />
                    )}
                  </div>
                </td>
                <td className="w-[128px] p-3 pr-2">
                  <div className="flex items-center">
                    <SourceIcon className="mr-1 size-4 text-text-tertiary" />
                    <span className="capitalize">{source.replace('_', ' ').replace('hit testing', 'retrieval test')}</span>
                  </div>
                </td>
                <td className="w-48 p-3 pr-2">
                  {formatTime(created_at, t('dateTimeFormat', { ns: 'datasetHitTesting' }) as string)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default React.memo(Records)
