import type { FC } from 'react'
import {
  Fragment,
  memo,
  useCallback,
  useState,
} from 'react'
import {
  RiZoomInLine,
  RiZoomOutLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import {
  useReactFlow,
  useViewport,
} from 'reactflow'
import {
  useNodesSyncDraft,
  useWorkflowReadOnly,
} from '../hooks'

import ShortcutsName from '../shortcuts-name'
import Divider from '../../base/divider'
import TipPopup from './tip-popup'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

enum ZoomType {
  zoomIn = 'zoomIn',
  zoomOut = 'zoomOut',
  zoomToFit = 'zoomToFit',
  zoomTo25 = 'zoomTo25',
  zoomTo50 = 'zoomTo50',
  zoomTo75 = 'zoomTo75',
  zoomTo100 = 'zoomTo100',
  zoomTo200 = 'zoomTo200',
}

const ZoomInOut: FC = () => {
  const { t } = useTranslation()
  const {
    zoomIn,
    zoomOut,
    zoomTo,
    fitView,
  } = useReactFlow()
  const { zoom } = useViewport()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const [open, setOpen] = useState(false)
  const {
    workflowReadOnly,
    getWorkflowReadOnly,
  } = useWorkflowReadOnly()

  const ZOOM_IN_OUT_OPTIONS = [
    [
      {
        key: ZoomType.zoomTo200,
        text: '200%',
      },
      {
        key: ZoomType.zoomTo100,
        text: '100%',
      },
      {
        key: ZoomType.zoomTo75,
        text: '75%',
      },
      {
        key: ZoomType.zoomTo50,
        text: '50%',
      },
      {
        key: ZoomType.zoomTo25,
        text: '25%',
      },
    ],
    [
      {
        key: ZoomType.zoomToFit,
        text: t('workflow.operator.zoomToFit'),
      },
    ],
  ]

  const handleZoom = (type: string) => {
    if (workflowReadOnly)
      return

    if (type === ZoomType.zoomToFit)
      fitView()

    if (type === ZoomType.zoomTo25)
      zoomTo(0.25)

    if (type === ZoomType.zoomTo50)
      zoomTo(0.5)

    if (type === ZoomType.zoomTo75)
      zoomTo(0.75)

    if (type === ZoomType.zoomTo100)
      zoomTo(1)

    if (type === ZoomType.zoomTo200)
      zoomTo(2)

    handleSyncWorkflowDraft()
  }

  const handleTrigger = useCallback(() => {
    if (getWorkflowReadOnly())
      return

    setOpen(v => !v)
  }, [getWorkflowReadOnly])

  return (
    <PortalToFollowElem
      placement='top-start'
      open={open}
      onOpenChange={setOpen}
      offset={{
        mainAxis: 4,
        crossAxis: -2,
      }}
    >
      <PortalToFollowElemTrigger asChild>
        <div className={`
          bg-components-actionbar-bg border-components-actionbar-border hover:bg-state-base-hover h-9 cursor-pointer rounded-lg
          border-[0.5px] p-0.5 text-[13px] shadow-lg 
          backdrop-blur-[5px]
          ${workflowReadOnly && '!cursor-not-allowed opacity-50'}
        `}>
          <div className={cn(
            'flex h-8 w-[98px] items-center justify-between rounded-lg',
          )}>
            <TipPopup
              title={t('workflow.operator.zoomOut')}
              shortcuts={['ctrl', '-']}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${zoom <= 0.25 ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-black/5'}`}
                onClick={(e) => {
                  if (zoom <= 0.25)
                    return

                  e.stopPropagation()
                  zoomOut()
                }}
              >
                <RiZoomOutLine className='text-text-tertiary hover:text-text-secondary h-4 w-4' />
              </div>
            </TipPopup>
            <div onClick={handleTrigger} className={cn('system-sm-medium text-text-tertiary hover:text-text-secondary w-[34px]')}>{parseFloat(`${zoom * 100}`).toFixed(0)}%</div>
            <TipPopup
              title={t('workflow.operator.zoomIn')}
              shortcuts={['ctrl', '+']}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${zoom >= 2 ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-black/5'}`}
                onClick={(e) => {
                  if (zoom >= 2)
                    return

                  e.stopPropagation()
                  zoomIn()
                }}
              >
                <RiZoomInLine className='text-text-tertiary hover:text-text-secondary h-4 w-4' />
              </div>
            </TipPopup>
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='border-components-panel-border bg-components-panel-bg-blur w-[145px] rounded-xl border-[0.5px] shadow-lg backdrop-blur-[5px]'>
          {
            ZOOM_IN_OUT_OPTIONS.map((options, i) => (
              <Fragment key={i}>
                {
                  i !== 0 && (
                    <Divider className='m-0' />
                  )
                }
                <div className='p-1'>
                  {
                    options.map(option => (
                      <div
                        key={option.key}
                        className='hover:bg-state-base-hover system-md-regular text-text-secondary flex h-8 cursor-pointer items-center justify-between space-x-1 rounded-lg py-1.5 pl-3 pr-2'
                        onClick={() => handleZoom(option.key)}
                      >
                        <span>{option.text}</span>
                        <div className='flex items-center space-x-0.5'>
                          {
                            option.key === ZoomType.zoomToFit && (
                              <ShortcutsName keys={['ctrl', '1']} />
                            )
                          }
                          {
                            option.key === ZoomType.zoomTo50 && (
                              <ShortcutsName keys={['shift', '5']} />
                            )
                          }
                          {
                            option.key === ZoomType.zoomTo100 && (
                              <ShortcutsName keys={['shift', '1']} />
                            )
                          }
                        </div>
                      </div>
                    ))
                  }
                </div>
              </Fragment>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(ZoomInOut)
