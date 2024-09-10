'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightSLine,
  RiCloseLine,
} from '@remixicon/react'
import { ArrowNarrowLeft } from '../../base/icons/src/vender/line/arrows'
import TracingPanel from './tracing-panel'
import { Iteration } from '@/app/components/base/icons/src/vender/workflow'
import cn from '@/utils/classnames'
import type { NodeTracing } from '@/types/workflow'
const i18nPrefix = 'workflow.singleRun'

type Props = {
  list: NodeTracing[][]
  onHide: () => void
  onBack: () => void
  noWrap?: boolean
}

const IterationResultPanel: FC<Props> = ({
  list,
  onHide,
  onBack,
  noWrap,
}) => {
  const { t } = useTranslation()
  const [expandedIterations, setExpandedIterations] = useState<Record<number, boolean>>([])

  const toggleIteration = useCallback((index: number) => {
    setExpandedIterations(prev => ({
      ...prev,
      [index]: !prev[index],
    }))
  }, [])

  const main = (
    <>
      <div className={cn(!noWrap && 'shrink-0 ', 'px-4 pt-3')}>
        <div className='shrink-0 flex justify-between items-center h-8'>
          <div className='system-xl-semibold text-text-primary truncate'>
            {t(`${i18nPrefix}.testRunIteration`)}
          </div>
          <div className='ml-2 shrink-0 p-1 cursor-pointer' onClick={onHide}>
            <RiCloseLine className='w-4 h-4 text-text-tertiary' />
          </div>
        </div>
        <div className='flex items-center py-2 space-x-1 text-text-accent-secondary cursor-pointer' onClick={onBack}>
          <ArrowNarrowLeft className='w-4 h-4' />
          <div className='system-sm-medium'>{t(`${i18nPrefix}.back`)}</div>
        </div>
      </div>
      {/* List */}
      <div className={cn(!noWrap ? 'flex-grow overflow-auto' : 'max-h-full', 'p-2 bg-components-panel-bg')}>
        {list.map((iteration, index) => (
          <div key={index} className={cn('mb-1 overflow-hidden rounded-xl bg-background-section-burn border-none')}>
            <div
              className={cn(
                'flex items-center justify-between w-full px-3 cursor-pointer',
                expandedIterations[index] ? 'pt-3 pb-2' : 'py-3',
                'rounded-xl text-left',
              )}
              onClick={() => toggleIteration(index)}
            >
              <div className={cn('flex items-center gap-2 flex-grow')}>
                <div className='flex items-center justify-center w-4 h-4 rounded-[5px] border-divider-subtle bg-util-colors-cyan-cyan-500 flex-shrink-0'>
                  <Iteration className='w-3 h-3 text-text-primary-on-surface' />
                </div>
                <span className='system-sm-semibold-uppercase text-text-primary flex-grow'>
                  {t(`${i18nPrefix}.iteration`)} {index + 1}
                </span>
                <RiArrowRightSLine className={cn(
                  'w-4 h-4 text-text-tertiary transition-transform duration-200 flex-shrink-0',
                  expandedIterations[index] && 'transform rotate-90',
                )} />
              </div>
            </div>
            {expandedIterations[index] && <div
              className="flex-grow h-px bg-divider-subtle"
            ></div>}
            <div className={cn(
              'overflow-hidden transition-all duration-200',
              expandedIterations[index] ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0',
            )}>
              <TracingPanel
                list={iteration}
                className='bg-background-section-burn'
              />
            </div>
          </div>
        ))}
      </div>
    </>
  )
  const handleNotBubble = useCallback((e: React.MouseEvent) => {
    // if not do this, it will trigger the message log modal disappear(useClickAway)
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
  }, [])

  if (noWrap)
    return main

  return (
    <div
      className='absolute inset-0 z-10 rounded-2xl pt-10'
      style={{
        backgroundColor: 'rgba(16, 24, 40, 0.20)',
      }}
      onClick={handleNotBubble}
    >
      <div className='h-full rounded-2xl bg-components-panel-bg flex flex-col'>
        {main}
      </div>
    </div >
  )
}
export default React.memo(IterationResultPanel)
