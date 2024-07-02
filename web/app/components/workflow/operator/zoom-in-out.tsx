import type { FC } from 'react'
import {
  Fragment,
  memo,
  useCallback,
  useState,
} from 'react'
import cn from 'classnames'
import {
  RiZoomInLine,
  RiZoomOutLine,
} from '@remixicon/react'
import { useKeyPress } from 'ahooks'
import { useTranslation } from 'react-i18next'
import {
  useReactFlow,
  useViewport,
} from 'reactflow'
import {
  useNodesSyncDraft,
  useWorkflowReadOnly,
} from '../hooks'
import {
  getKeyboardKeyCodeBySystem,
  getKeyboardKeyNameBySystem,
  isEventTargetInputArea,
} from '../utils'
import ShortcutsName from '../shortcuts-name'
import TipPopup from './tip-popup'
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

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.1`, (e) => {
    e.preventDefault()
    if (workflowReadOnly)
      return

    fitView()
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress('shift.1', (e) => {
    if (workflowReadOnly)
      return

    if (isEventTargetInputArea(e.target as HTMLElement))
      return

    e.preventDefault()
    zoomTo(1)
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress('shift.2', (e) => {
    if (workflowReadOnly)
      return

    if (isEventTargetInputArea(e.target as HTMLElement))
      return

    e.preventDefault()
    zoomTo(2)
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress('shift.5', (e) => {
    if (workflowReadOnly)
      return

    if (isEventTargetInputArea(e.target as HTMLElement))
      return

    e.preventDefault()
    zoomTo(0.5)
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.dash`, (e) => {
    e.preventDefault()
    if (workflowReadOnly)
      return

    zoomOut()
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.equalsign`, (e) => {
    e.preventDefault()
    if (workflowReadOnly)
      return

    zoomIn()
    handleSyncWorkflowDraft()
  }, {
    exactMatch: true,
    useCapture: true,
  })

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
      <PortalToFollowElemTrigger asChild onClick={handleTrigger}>
        <div className={`
          p-0.5 h-9 cursor-pointer text-[13px] text-gray-500 font-medium rounded-lg bg-white shadow-lg border-[0.5px] border-gray-100
          ${workflowReadOnly && '!cursor-not-allowed opacity-50'}
        `}>
          <div className={cn(
            'flex items-center justify-between w-[98px] h-8 hover:bg-gray-50 rounded-lg',
            open && 'bg-gray-50',
          )}>
            <TipPopup
              title={t('workflow.operator.zoomOut')}
              shortcuts={['ctrl', '-']}
            >
              <div
                className='flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer hover:bg-black/5'
                onClick={(e) => {
                  e.stopPropagation()
                  zoomOut()
                }}
              >
                <RiZoomOutLine className='w-4 h-4' />
              </div>
            </TipPopup>
            <div className='w-[34px]'>{parseFloat(`${zoom * 100}`).toFixed(0)}%</div>
            <TipPopup
              title={t('workflow.operator.zoomIn')}
              shortcuts={['ctrl', '+']}
            >
              <div
                className='flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer hover:bg-black/5'
                onClick={(e) => {
                  e.stopPropagation()
                  zoomIn()
                }}
              >
                <RiZoomInLine className='w-4 h-4' />
              </div>
            </TipPopup>
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='w-[145px] rounded-lg border-[0.5px] border-gray-200 bg-white shadow-lg'>
          {
            ZOOM_IN_OUT_OPTIONS.map((options, i) => (
              <Fragment key={i}>
                {
                  i !== 0 && (
                    <div className='h-[1px] bg-gray-100' />
                  )
                }
                <div className='p-1'>
                  {
                    options.map(option => (
                      <div
                        key={option.key}
                        className='flex items-center justify-between px-3 h-8 rounded-lg hover:bg-gray-50 cursor-pointer text-sm text-gray-700'
                        onClick={() => handleZoom(option.key)}
                      >
                        {option.text}
                        {
                          option.key === ZoomType.zoomToFit && (
                            <ShortcutsName keys={[`${getKeyboardKeyNameBySystem('ctrl')}`, '1']} />
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
                        {
                          option.key === ZoomType.zoomTo200 && (
                            <ShortcutsName keys={['shift', '2']} />
                          )
                        }
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
