import { Fragment, useState } from 'react'
import type { FC } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import Tooltip from './tooltip'
import ProgressTooltip from './progress-tooltip'
import type { Resources } from './index'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import FileIcon from '@/app/components/base/file-icon'
import {
  Hash02,
  Target04,
} from '@/app/components/base/icons/src/vender/line/general'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'
import {
  BezierCurve03,
  TypeSquare,
} from '@/app/components/base/icons/src/vender/line/editor'

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
  const fileType = data.dataSourceType === 'upload_file'
    ? (/\.([^.]*)$/g.exec(data.documentName)?.[1] || '')
    : 'notion'

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='top-start'
      offset={{
        mainAxis: 8,
        crossAxis: -2,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className='flex items-center px-2 max-w-[240px] h-7 bg-white rounded-lg'>
          <FileIcon type={fileType} className='shrink-0 mr-1 w-4 h-4' />
          <div className='text-xs text-gray-600 truncate'>{data.documentName}</div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1000 }}>
        <div className='w-[360px] bg-gray-50 rounded-xl shadow-lg'>
          <div className='px-4 pt-3 pb-2'>
            <div className='flex items-center h-[18px]'>
              <FileIcon type={fileType} className='shrink-0 mr-1 w-4 h-4' />
              <div className='text-xs font-medium text-gray-600 truncate'>{data.documentName}</div>
            </div>
          </div>
          <div className='px-4 py-0.5 max-h-[450px] bg-white rounded-lg overflow-auto'>
            {
              data.sources.map((source, index) => (
                <Fragment key={index}>
                  <div className='group py-3'>
                    {
                      showHitInfo && (
                        <div className='flex items-center justify-between mb-2'>
                          <div className='flex items-center px-1.5 h-5 border border-gray-200 rounded-md'>
                            <Hash02 className='mr-0.5 w-3 h-3 text-gray-400' />
                            <div className='text-[11px] font-medium text-gray-500'>{source.segment_position}</div>
                          </div>
                          <Link
                            href={`/datasets/${source.dataset_id}/documents/${source.document_id}`}
                            className='hidden items-center h-[18px] text-xs text-primary-600 group-hover:flex'>
                            {t('common.chat.citation.linkToDataset')}
                            <ArrowUpRight className='ml-1 w-3 h-3' />
                          </Link>
                        </div>
                      )
                    }
                    <div className='text-[13px] text-gray-800'>{source.content}</div>
                    {
                      showHitInfo && (
                        <div className='flex items-center mt-2 text-xs font-medium text-gray-500'>
                          <Tooltip
                            text={t('common.chat.citation.characters')}
                            data={source.word_count}
                            icon={<TypeSquare className='mr-1 w-3 h-3' />}
                          />
                          <Tooltip
                            text={t('common.chat.citation.hitCount')}
                            data={source.hit_count}
                            icon={<Target04 className='mr-1 w-3 h-3' />}
                          />
                          <Tooltip
                            text={t('common.chat.citation.vectorHash')}
                            data={source.index_node_hash.substring(0, 7)}
                            icon={<BezierCurve03 className='mr-1 w-3 h-3' />}
                          />
                          {
                            source.score && (
                              <ProgressTooltip data={Number(source.score.toFixed(2))} />
                            )
                          }
                        </div>
                      )
                    }
                  </div>
                  {
                    index !== data.sources.length - 1 && (
                      <div className='my-1 h-[1px] bg-black/5' />
                    )
                  }
                </Fragment>
              ))
            }
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Popup
