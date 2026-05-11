import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  Fragment,
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  useReactFlow,
  useViewport,
} from 'reactflow'
import TipPopup from '@/app/components/workflow/operator/tip-popup'
import { ShortcutKbd } from '@/app/components/workflow/shortcuts/shortcut-kbd'

enum ZoomType {
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

  const zoomOptions = [
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
    setOpen(false)

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

  return (
    <div
      className={cn(
        'h-9 cursor-pointer rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg',
        'p-0.5 text-[13px] shadow-lg backdrop-blur-[5px]',
        'hover:bg-state-base-hover',
      )}
    >
      <div className="flex h-8 w-[98px] items-center justify-between rounded-lg">
        <TipPopup
          title={t('operator.zoomOut', { ns: 'workflow' })}
          shortcut="workflow.zoom-out"
        >
          <button
            type="button"
            aria-label={t('operator.zoomOut', { ns: 'workflow' })}
            disabled={zoom <= 0.25}
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${zoom <= 0.25 ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-black/5'}`}
            onClick={(e) => {
              if (zoom <= 0.25)
                return

              e.stopPropagation()
              zoomOut()
            }}
          >
            <span aria-hidden className="i-ri-zoom-out-line h-4 w-4 text-text-tertiary hover:text-text-secondary" />
          </button>
        </TipPopup>
        <DropdownMenu
          open={open}
          onOpenChange={setOpen}
        >
          <DropdownMenuTrigger className={cn('flex h-8 w-[34px] items-center justify-center rounded-lg system-sm-medium text-text-tertiary hover:bg-black/5 hover:text-text-secondary', open && 'bg-black/5 text-text-secondary')}>
            {Number.parseFloat(`${zoom * 100}`).toFixed(0)}
            %
          </DropdownMenuTrigger>
          <DropdownMenuContent
            placement="top-start"
            sideOffset={4}
            alignOffset={-2}
            popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
          >
            <div className="w-[145px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]">
              {zoomOptions.map((options, groupIndex) => (
                <Fragment key={options[0]!.key}>
                  {groupIndex !== 0 && (
                    <DropdownMenuSeparator className="my-0" />
                  )}
                  <div className="p-1">
                    {options.map(option => (
                      <DropdownMenuItem
                        key={option.key}
                        className="justify-between px-3 py-1.5 system-md-regular text-text-secondary"
                        onClick={() => handleZoom(option.key)}
                      >
                        <span>{option.text}</span>
                        <div className="flex items-center space-x-0.5">
                          {option.key === ZoomType.zoomToFit && (
                            <ShortcutKbd shortcut="workflow.zoom-to-fit" />
                          )}
                          {option.key === ZoomType.zoomTo50 && (
                            <ShortcutKbd shortcut="workflow.zoom-to-50" />
                          )}
                          {option.key === ZoomType.zoomTo100 && (
                            <ShortcutKbd shortcut="workflow.zoom-to-100" />
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </div>
                </Fragment>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <TipPopup
          title={t('operator.zoomIn', { ns: 'workflow' })}
          shortcut="workflow.zoom-in"
        >
          <button
            type="button"
            aria-label={t('operator.zoomIn', { ns: 'workflow' })}
            disabled={zoom >= 2}
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${zoom >= 2 ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-black/5'}`}
            onClick={(e) => {
              if (zoom >= 2)
                return

              e.stopPropagation()
              zoomIn()
            }}
          >
            <span aria-hidden className="i-ri-zoom-in-line h-4 w-4 text-text-tertiary hover:text-text-secondary" />
          </button>
        </TipPopup>
      </div>
    </div>
  )
}

export default memo(ZoomInOut)
