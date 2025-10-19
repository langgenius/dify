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
  const fileType = data.dataSourceType !== 'notion'
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
        <div className='flex h-7 max-w-[240px] items-center rounded-lg bg-components-button-secondary-bg px-2'>
          <FileIcon type={fileType} className='mr-1 h-4 w-4 shrink-0' />
          <div className='truncate text-xs text-text-tertiary'>{data.documentName}</div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1000 }}>
        <div className='max-w-[360px] rounded-xl bg-background-section-burn shadow-lg'>
          <div className='px-4 pb-2 pt-3'>
            <div className='flex h-[18px] items-center'>
              <FileIcon type={fileType} className='mr-1 h-4 w-4 shrink-0' />
              <div className='system-xs-medium truncate text-text-tertiary'>{data.documentName}</div>
            </div>
          </div>
          <div className='max-h-[450px] overflow-y-auto rounded-lg bg-components-panel-bg px-4 py-0.5'>
            <div className='w-full'>
              {
                data.sources.map((source, index) => (
                  <Fragment key={index}>
                    <div className='group py-3'>
                      <div className='mb-2 flex items-center justify-between'>
                        <div className='flex h-5 items-center rounded-md border border-divider-subtle px-1.5'>
                          <Hash02 className='mr-0.5 h-3 w-3 text-text-quaternary' />
                          <div className='text-[11px] font-medium text-text-tertiary'>
                            {source.segment_position || index + 1}
                          </div>
                        </div>
                        {
                          showHitInfo && (
                            <Link
                              href={`/datasets/${source.dataset_id}/documents/${source.document_id}`}
                              className='hidden h-[18px] items-center text-xs text-text-accent group-hover:flex'>
                              {t('common.chat.citation.linkToDataset')}
                              <ArrowUpRight className='ml-1 h-3 w-3' />
                            </Link>
                          )
                        }
                      </div>
                      <div className='break-words text-[13px] text-text-secondary'>{source.content}</div>
                      {
                        showHitInfo && (
                          <div className='system-xs-medium mt-2 flex flex-wrap items-center text-text-quaternary'>
                            <Tooltip
                              text={t('common.chat.citation.characters')}
                              data={source.word_count}
                              icon={<TypeSquare className='mr-1 h-3 w-3' />}
                            />
                            <Tooltip
                              text={t('common.chat.citation.hitCount')}
                              data={source.hit_count}
                              icon={<Target04 className='mr-1 h-3 w-3' />}
                            />
                            <Tooltip
                              text={t('common.chat.citation.vectorHash')}
                              data={source.index_node_hash?.substring(0, 7)}
                              icon={<BezierCurve03 className='mr-1 h-3 w-3' />}
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
                        <div className='my-1 h-px bg-divider-regular' />
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
