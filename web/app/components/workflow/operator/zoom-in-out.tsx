import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { useGlobalPublicStore } from '@/context/global-public-context'
import {
  useNodesSyncDraft,
  useWorkflowReadOnly,
} from '../hooks'
import ShortcutsName from '../shortcuts-name'
import TipPopup from './tip-popup'

enum ZoomType {
  zoomToFit = 'zoomToFit',
  zoomTo25 = 'zoomTo25',
  zoomTo50 = 'zoomTo50',
  zoomTo75 = 'zoomTo75',
  zoomTo100 = 'zoomTo100',
  zoomTo200 = 'zoomTo200',
  toggleUserComments = 'toggleUserComments',
  toggleUserCursors = 'toggleUserCursors',
  toggleMiniMap = 'toggleMiniMap',
}

type ZoomInOutProps = {
  showMiniMap?: boolean
  onToggleMiniMap?: () => void
  showUserCursors?: boolean
  onToggleUserCursors?: () => void
  showUserComments?: boolean
  onToggleUserComments?: () => void
  isCommentMode?: boolean
}

const ZoomInOut: FC<ZoomInOutProps> = ({
  showMiniMap = true,
  onToggleMiniMap,
  showUserCursors = true,
  onToggleUserCursors,
  showUserComments = true,
  onToggleUserComments,
  isCommentMode = false,
}) => {
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
  const isCollaborationEnabled = useGlobalPublicStore(s => s.systemFeatures.enable_collaboration_mode)

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
      {
        key: ZoomType.zoomToFit,
        text: t('operator.zoomToFit', { ns: 'workflow' }),
      },
    ],
    isCollaborationEnabled
      ? [
          {
            key: ZoomType.toggleUserComments,
            text: t('operator.showUserComments', { ns: 'workflow' }),
          },
          {
            key: ZoomType.toggleUserCursors,
            text: t('operator.showUserCursors', { ns: 'workflow' }),
          },
          {
            key: ZoomType.toggleMiniMap,
            text: t('operator.showMiniMap', { ns: 'workflow' }),
          },
        ]
      : [
          {
            key: ZoomType.toggleMiniMap,
            text: t('operator.showMiniMap', { ns: 'workflow' }),
          },
        ],
  ]

  const handleZoom = (type: string) => {
    if (workflowReadOnly)
      return

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

    if (type === ZoomType.toggleUserComments) {
      if (!isCommentMode)
        onToggleUserComments?.()

      return
    }

    if (type === ZoomType.toggleUserCursors) {
      onToggleUserCursors?.()
      return
    }

    if (type === ZoomType.toggleMiniMap) {
      onToggleMiniMap?.()
      return
    }

    handleSyncWorkflowDraft()
  }

  return (
    <div className={`
      h-9 cursor-pointer rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg
      p-0.5 text-[13px] shadow-lg backdrop-blur-[5px]
      hover:bg-state-base-hover
      ${workflowReadOnly && 'cursor-not-allowed! opacity-50'}
    `}
    >
      <div className="flex h-8 w-[98px] items-center justify-between rounded-lg">
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
            <span aria-hidden className="i-ri-zoom-out-line h-4 w-4 text-text-tertiary hover:text-text-secondary" />
          </div>
        </TipPopup>
        <DropdownMenu
          open={open}
          onOpenChange={setOpen}
        >
          <DropdownMenuTrigger
            disabled={getWorkflowReadOnly()}
            className={cn(
              'flex h-8 w-[34px] items-center justify-center rounded-lg system-sm-medium text-text-tertiary hover:bg-black/5 hover:text-text-secondary',
              open && 'bg-black/5 text-text-secondary',
            )}
          >
            {Number.parseFloat(`${zoom * 100}`).toFixed(0)}
            %
          </DropdownMenuTrigger>
          <DropdownMenuContent
            placement="top-start"
            sideOffset={4}
            alignOffset={-2}
            popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
          >
            <div className="w-[192px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]">
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
                        disabled={option.key === ZoomType.toggleUserComments && isCommentMode}
                        onClick={() => handleZoom(option.key)}
                      >
                        <div className="flex items-center gap-2">
                          {option.key === ZoomType.toggleUserComments && showUserComments && (
                            <span aria-hidden className="i-ri-check-line h-4 w-4 text-text-accent" />
                          )}
                          {option.key === ZoomType.toggleUserComments && !showUserComments && (
                            <span aria-hidden className="h-4 w-4" />
                          )}
                          {option.key === ZoomType.toggleUserCursors && showUserCursors && (
                            <span aria-hidden className="i-ri-check-line h-4 w-4 text-text-accent" />
                          )}
                          {option.key === ZoomType.toggleUserCursors && !showUserCursors && (
                            <span aria-hidden className="h-4 w-4" />
                          )}
                          {option.key === ZoomType.toggleMiniMap && showMiniMap && (
                            <span aria-hidden className="i-ri-check-line h-4 w-4 text-text-accent" />
                          )}
                          {option.key === ZoomType.toggleMiniMap && !showMiniMap && (
                            <span aria-hidden className="h-4 w-4" />
                          )}
                          {option.key === ZoomType.zoomToFit && (
                            <span aria-hidden className="i-ri-fullscreen-line h-4 w-4 text-text-tertiary" />
                          )}
                          {option.key !== ZoomType.toggleUserComments
                            && option.key !== ZoomType.toggleUserCursors
                            && option.key !== ZoomType.toggleMiniMap
                            && option.key !== ZoomType.zoomToFit && (
                            <span aria-hidden className="h-4 w-4" />
                          )}
                          <span>{option.text}</span>
                        </div>
                        <div className="flex items-center space-x-0.5">
                          {option.key === ZoomType.zoomToFit && (
                            <ShortcutsName keys={['ctrl', '1']} />
                          )}
                          {option.key === ZoomType.zoomTo50 && (
                            <ShortcutsName keys={['shift', '5']} />
                          )}
                          {option.key === ZoomType.zoomTo100 && (
                            <ShortcutsName keys={['shift', '1']} />
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
            <span aria-hidden className="i-ri-zoom-in-line h-4 w-4 text-text-tertiary hover:text-text-secondary" />
          </div>
        </TipPopup>
      </div>
    </div>
  )
}

export default memo(ZoomInOut)
