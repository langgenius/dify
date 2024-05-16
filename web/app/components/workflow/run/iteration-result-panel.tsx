'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { ArrowNarrowLeft } from '../../base/icons/src/vender/line/arrows'
import NodePanel from './node'
import type { NodeTracing } from '@/types/workflow'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
const i18nPrefix = 'workflow.singleRun'

type Props = {
  list: NodeTracing[][]
  onHide: () => void
}

const IterationResultPanel: FC<Props> = ({
  list,
  onHide,
}) => {
  const { t } = useTranslation()

  return (
    <div className='absolute inset-0 z-10 rounded-2xl pt-10' style={{
      backgroundColor: 'rgba(16, 24, 40, 0.20)',
    }}>
      <div className='h-full rounded-2xl bg-white flex flex-col'>
        <div className='shrink-0 pl-4 pr-3 pt-3'>
          <div className='shrink-0 flex justify-between items-center h-8'>
            <div className='text-base font-semibold text-gray-900 truncate'>
              {t(`${i18nPrefix}.testRunIteration`)}
            </div>
            <div className='ml-2 shrink-0 p-1 cursor-pointer' onClick={onHide}>
              <XClose className='w-4 h-4 text-gray-500 ' />
            </div>
          </div>
          <div className='flex items-center py-2 space-x-1 text-primary-600 cursor-pointer' onClick={onHide}>
            <ArrowNarrowLeft className='w-4 h-4' />
            <div className='leading-[18px] text-[13px] font-medium'>{t(`${i18nPrefix}.back`)}</div>
          </div>
        </div>
        {/* List */}
        <div className='h-0 grow overflow-y-auto px-4 pb-4 bg-gray-50'>
          {list.map((iteration, index) => (
            <div key={index} className={cn('my-4', index === 0 && 'mt-2')}>
              <div className='flex items-center'>
                <div className='shrink-0 leading-[18px] text-xs font-semibold text-gray-500 uppercase'>{t(`${i18nPrefix}.iteration`)} {index + 1}</div>
                <div
                  className='ml-3 grow w-0 h-px'
                  style={{ background: 'linear-gradient(to right, #F3F4F6, rgba(243, 244, 246, 0))' }}
                ></div>
              </div>
              <div className='mt-0.5 space-y-1'>
                {iteration.map(node => (
                  <NodePanel
                    key={node.id}
                    className='!px-0 !py-0'
                    nodeInfo={node}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div >
  )
}
export default React.memo(IterationResultPanel)
