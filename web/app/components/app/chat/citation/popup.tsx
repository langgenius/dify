import { useState } from 'react'
import type { FC } from 'react'
import Link from 'next/link'
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
        <div className='flex items-center mr-1 px-2 max-w-[240px] h-7 bg-white rounded-lg'>
          <FileIcon type={fileType} className='mr-1 w-4 h-4' />
          <div className='text-xs text-gray-600 truncate'>{data.documentName}</div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='w-[360px] bg-gray-50 rounded-xl shadow-lg'>
          <div className='px-4 pt-3 pb-2'>
            <div className='flex items-center h-[18px]'>
              <FileIcon type={fileType} className='mr-1 w-4 h-4' />
              <div className='text-xs font-medium text-gray-600 truncate'>{data.documentName}</div>
            </div>
          </div>
          <div className='px-4 py-0.5 bg-white rounded-lg'>
            {
              data.sources.map((source, index) => (
                <>
                  <div key={index} className='group py-3'>
                    {
                      showHitInfo && (
                        <div className='flex items-center mb-2'>
                          <div className='flex items-center px-1.5 h-5 border border-gray-200 rounded-md'>
                            <Hash02 className='mr-0.5 w-3 h-3 text-gray-400' />
                            <div className='text-[11px] font-medium text-gray-500'>{source.source.segment_position}</div>
                          </div>
                          <Link
                            href={`/datasets/${source.source.dataset_id}/documents/${source.source.document_id}`}
                            className='hidden items-center h-[18px] text-primary-600 group-hover:flex'>
                            Link to dataset
                            <ArrowUpRight className='ml-1 w-3 h-3' />
                          </Link>
                        </div>
                      )
                    }
                    <div className='text-[13px] text-gray-800'>{source.content}</div>
                    {
                      showHitInfo && (
                        <div className='flex items-center mt-2 text-xs font-medium text-gray-500'>
                          <div className='flex items-center mr-6'>
                            <TypeSquare className='mr-1 w-3 h-3' />
                            {source.source.hit_count}
                          </div>
                          <div className='flex items-center mr-6'>
                            <Target04 className='mr-1 w-3 h-3' />
                            {source.source.hit_count}
                          </div>
                          <div className='flex items-center mr-6'>
                            <BezierCurve03 className='mr-1 w-3 h-3' />
                            {source.source.index_node_hash.substring(0, 7)}
                          </div>
                          <div className='grow flex items-center'>
                            <div className='mr-1 w-16 h-1.5 rounded-[3px] border border-gray-400'>
                              <div style={{ width: `${source.source.score * 100}%` }}></div>
                            </div>
                            {source.source.score}
                          </div>
                        </div>
                      )
                    }
                  </div>
                  {
                    index !== data.sources.length - 1 && (
                      <div className='my-1 h-[1px] bg-black/5' />
                    )
                  }
                </>
              ))
            }
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Popup
