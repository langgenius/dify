import type { FC } from 'react'
import {
  RiZoomInLine,
  RiZoomOutLine,
} from '@remixicon/react'
import {
  Fragment,
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  useReactFlow,
  useViewport,
} from 'reactflow'
import Divider from '@/app/components/base/divider'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import TipPopup from '@/app/components/workflow/operator/tip-popup'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'
import { cn } from '@/utils/classnames'

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
  const [open, setOpen] = useState(false)

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
        text: t('operator.zoomToFit', { ns: 'workflow' }),
      },
    ],
  ]

  const handleZoom = (type: string) => {
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
  }

  const handleTrigger = useCallback(() => {
    setOpen(v => !v)
  }, [])

  return (
    <PortalToFollowElem
      placement="top-start"
      open={open}
      onOpenChange={setOpen}
      offset={{
        mainAxis: 4,
        crossAxis: -2,
      }}
    >
      <PortalToFollowElemTrigger asChild>
        <div
          className={cn(
            'h-9 cursor-pointer rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg',
            'p-0.5 text-[13px] shadow-lg backdrop-blur-[5px]',
            'hover:bg-state-base-hover',
          )}
        >
          <div className={cn(
            'flex h-8 w-[98px] items-center justify-between rounded-lg',
          )}
          >
            <TipPopup
              title={t('operator.zoomOut', { ns: 'workflow' })}
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
                <RiZoomOutLine className="h-4 w-4 text-text-tertiary hover:text-text-secondary" />
              </div>
            </TipPopup>
            <div onClick={handleTrigger} className={cn('system-sm-medium w-[34px] text-text-tertiary hover:text-text-secondary')}>
              {Number.parseFloat(`${zoom * 100}`).toFixed(0)}
              %
            </div>
            <TipPopup
              title={t('operator.zoomIn', { ns: 'workflow' })}
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
                <RiZoomInLine className="h-4 w-4 text-text-tertiary hover:text-text-secondary" />
              </div>
            </TipPopup>
          </div>
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-10">
        <div className="w-[145px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]">
          {
            ZOOM_IN_OUT_OPTIONS.map((options, i) => (
              <Fragment key={i}>
                {
                  i !== 0 && (
                    <Divider className="m-0" />
                  )
                }
                <div className="p-1">
                  {
                    options.map(option => (
                      <div
                        key={option.key}
                        className="system-md-regular flex h-8 cursor-pointer items-center justify-between space-x-1 rounded-lg py-1.5 pl-3 pr-2 text-text-secondary hover:bg-state-base-hover"
                        onClick={() => handleZoom(option.key)}
                      >
                        <span>{option.text}</span>
                        <div className="flex items-center space-x-0.5">
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
