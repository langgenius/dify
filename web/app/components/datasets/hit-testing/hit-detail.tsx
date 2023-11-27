import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import ReactECharts from 'echarts-for-react'
import { SegmentIndexTag } from '../documents/detail/completed'
import s from '../documents/detail/completed/style.module.css'
import type { SegmentDetailModel } from '@/models/datasets'
import Divider from '@/app/components/base/divider'

type IScatterChartProps = {
  data: Array<number[]>
  curr: Array<number[]>
}

const ScatterChart: FC<IScatterChartProps> = ({ data, curr }) => {
  const option = {
    xAxis: {},
    yAxis: {},
    tooltip: {
      trigger: 'item',
      axisPointer: {
        type: 'cross',
      },
    },
    series: [
      {
        type: 'effectScatter',
        symbolSize: 5,
        data: curr,
      },
      {
        type: 'scatter',
        symbolSize: 5,
        data,
      },
    ],
  }
  return (
    <ReactECharts option={option} style={{ height: 380, width: 430 }} />
  )
}

type IHitDetailProps = {
  segInfo?: Partial<SegmentDetailModel> & { id: string }
  vectorInfo?: { curr: Array<number[]>; points: Array<number[]> }
}

const HitDetail: FC<IHitDetailProps> = ({ segInfo, vectorInfo }) => {
  const { t } = useTranslation()

  const renderContent = () => {
    if (segInfo?.answer) {
      return (
        <>
          <div className='mt-2 mb-1 text-xs font-medium text-gray-500'>QUESTION</div>
          <div className='mb-4 text-md text-gray-800'>{segInfo.content}</div>
          <div className='mb-1 text-xs font-medium text-gray-500'>ANSWER</div>
          <div className='text-md text-gray-800'>{segInfo.answer}</div>
        </>
      )
    }

    return segInfo?.content
  }

  return (
    <div className='flex flex-row overflow-x-auto'>
      <div className="flex-1 bg-gray-25 p-6 min-w-[300px]">
        <div className="flex items-center">
          <SegmentIndexTag
            positionId={segInfo?.position || ''}
            className="w-fit mr-6"
          />
          <div className={cn(s.commonIcon, s.typeSquareIcon)} />
          <span className={cn('mr-6', s.numberInfo)}>
            {segInfo?.word_count} {t('datasetDocuments.segment.characters')}
          </span>
          <div className={cn(s.commonIcon, s.targetIcon)} />
          <span className={s.numberInfo}>
            {segInfo?.hit_count} {t('datasetDocuments.segment.hitCount')}
          </span>
        </div>
        <Divider />
        <div className={s.segModalContent}>{renderContent()}</div>
        <div className={s.keywordTitle}>
          {t('datasetDocuments.segment.keywords')}
        </div>
        <div className={s.keywordWrapper}>
          {!segInfo?.keywords?.length
            ? '-'
            : segInfo?.keywords?.map((word, index) => {
              return <div key={index} className={s.keyword}>{word}</div>
            })}
        </div>
      </div>
      <div className="flex-1 bg-white p-6">
        <div className="flex items-center">
          <div className={cn(s.commonIcon, s.bezierCurveIcon)} />
          <span className={s.numberInfo}>
            {t('datasetDocuments.segment.vectorHash')}
          </span>
        </div>
        <div
          className={cn(s.numberInfo, 'w-[400px] truncate text-gray-700 mt-1')}
        >
          {segInfo?.index_node_hash}
        </div>
        <ScatterChart data={vectorInfo?.points || []} curr={vectorInfo?.curr || []} />
      </div>
    </div>
  )
}

export default HitDetail
