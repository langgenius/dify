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
import { Loop } from '@/app/components/base/icons/src/vender/workflow'
import cn from '@/utils/classnames'
import type { NodeTracing } from '@/types/workflow'

const i18nPrefix = 'workflow.singleRun'

type Props = {
  list: NodeTracing[][]
  onHide: () => void
  onBack: () => void
  noWrap?: boolean
}

const LoopResultPanel: FC<Props> = ({
  list,
  onHide,
  onBack,
  noWrap,
}) => {
  const { t } = useTranslation()
  const [expandedLoops, setExpandedLoops] = useState<Record<number, boolean>>([])

  const toggleLoop = useCallback((index: number) => {
    setExpandedLoops(prev => ({
      ...prev,
      [index]: !prev[index],
    }))
  }, [])

  const main = (
    <>
      <div className={cn(!noWrap && 'shrink-0 ', 'px-4 pt-3')}>
        <div className='flex h-8 shrink-0 items-center justify-between'>
          <div className='system-xl-semibold truncate text-text-primary'>
            {t(`${i18nPrefix}.testRunLoop`)}
          </div>
          <div className='ml-2 shrink-0 cursor-pointer p-1' onClick={onHide}>
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
        <div className='flex cursor-pointer items-center space-x-1 py-2 text-text-accent-secondary' onClick={onBack}>
          <ArrowNarrowLeft className='h-4 w-4' />
          <div className='system-sm-medium'>{t(`${i18nPrefix}.back`)}</div>
        </div>
      </div>
      {/* List */}
      <div className={cn(!noWrap ? 'grow overflow-auto' : 'max-h-full', 'bg-components-panel-bg p-2')}>
        {list.map((loop, index) => (
          <div key={index} className={cn('mb-1 overflow-hidden rounded-xl border-none bg-background-section-burn')}>
            <div
              className={cn(
                'flex w-full cursor-pointer items-center justify-between px-3',
                expandedLoops[index] ? 'pb-2 pt-3' : 'py-3',
                'rounded-xl text-left',
              )}
              onClick={() => toggleLoop(index)}
            >
              <div className={cn('flex grow items-center gap-2')}>
                <div className='flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-divider-subtle bg-util-colors-cyan-cyan-500'>
                  <Loop className='h-3 w-3 text-text-primary-on-surface' />
                </div>
                <span className='system-sm-semibold-uppercase grow text-text-primary'>
                  {t(`${i18nPrefix}.loop`)} {index + 1}
                </span>
                <RiArrowRightSLine className={cn(
                  'h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-200',
                  expandedLoops[index] && 'rotate-90',
                )} />
              </div>
            </div>
            {expandedLoops[index] && <div
              className="h-px grow bg-divider-subtle"
            ></div>}
            <div className={cn(
              'transition-all duration-200',
              expandedLoops[index]
                ? 'opacity-100'
                : 'max-h-0 overflow-hidden opacity-0',
            )}>
              <TracingPanel
                list={loop}
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
      <div className='flex h-full flex-col rounded-2xl bg-components-panel-bg'>
        {main}
      </div>
    </div >
  )
}
export default React.memo(LoopResultPanel)
