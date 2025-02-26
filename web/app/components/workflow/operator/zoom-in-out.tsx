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
          p-0.5 h-9 cursor-pointer text-[13px] backdrop-blur-[5px] rounded-lg
          bg-components-actionbar-bg shadow-lg border-[0.5px] border-components-actionbar-border 
          hover:bg-state-base-hover
          ${workflowReadOnly && '!cursor-not-allowed opacity-50'}
        `}>
          <div className={cn(
            'flex items-center justify-between w-[98px] h-8 rounded-lg',
          )}>
            <TipPopup
              title={t('workflow.operator.zoomOut')}
              shortcuts={['ctrl', '-']}
            >
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-lg ${zoom <= 0.25 ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-black/5'}`}
                onClick={(e) => {
                  if (zoom <= 0.25)
                    return

                  e.stopPropagation()
                  zoomOut()
                }}
              >
                <RiZoomOutLine className='w-4 h-4 text-text-tertiary hover:text-text-secondary' />
              </div>
            </TipPopup>
            <div onClick={handleTrigger} className={cn('w-[34px] system-sm-medium text-text-tertiary hover:text-text-secondary')}>{parseFloat(`${zoom * 100}`).toFixed(0)}%</div>
            <TipPopup
              title={t('workflow.operator.zoomIn')}
              shortcuts={['ctrl', '+']}
            >
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-lg ${zoom >= 2 ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-black/5'}`}
                onClick={(e) => {
                  if (zoom >= 2)
                    return

                  e.stopPropagation()
                  zoomIn()
                }}
              >
                <RiZoomInLine className='w-4 h-4 text-text-tertiary hover:text-text-secondary' />
              </div>
            </TipPopup>
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='w-[145px] backdrop-blur-[5px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
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
                        className='flex items-center justify-between space-x-1 py-1.5 pl-3 pr-2 h-8 rounded-lg hover:bg-state-base-hover cursor-pointer system-md-regular text-text-secondary'
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
