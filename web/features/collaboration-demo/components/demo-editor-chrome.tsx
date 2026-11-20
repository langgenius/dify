'use client'

import type { ComponentProps, Ref } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Separator } from '@langgenius/dify-ui/separator'
import { Toggle } from '@langgenius/dify-ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { MiniMap, useViewport } from 'reactflow'
import { DemoMembers } from './demo-members'

function ToolIcon({ icon, pressed }: { icon: string; pressed?: boolean }) {
  return (
    <span
      data-pressed={pressed || undefined}
      className="inline-flex size-8 items-center justify-center rounded-md p-1.5 text-text-tertiary data-pressed:bg-state-accent-active data-pressed:text-text-accent"
    >
      <span className={`${icon} size-4`} />
    </span>
  )
}

function ToolSeparator() {
  return <Separator decorative className="my-1 h-[0.5px] w-3.5" />
}

type DemoHeaderProps = {
  membersGuide: ComponentProps<typeof DemoMembers>['guide']
  membersRef: (element: HTMLElement | null) => void
  onExit: () => void
}

export function DemoHeader({ membersGuide, membersRef, onExit }: DemoHeaderProps) {
  const { t } = useTranslation(['collaborationDemo', 'workflow'])

  return (
    <div className="absolute inset-s-0 top-7 z-10 flex h-0 w-full items-center justify-between bg-mask-top2bottom-gray-50-to-transparent px-3">
      <div className="flex w-full items-center justify-between">
        <h1 className="system-sm-semibold text-text-primary">{t(($) => $.title)}</h1>
        <div className="flex items-center gap-2">
          <DemoMembers guide={membersGuide} pillRef={membersRef} />
          <div inert aria-hidden className="flex items-center gap-2">
            <Separator decorative orientation="vertical" className="mx-auto h-3.5" />
            <div className="flex h-8 items-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-0.5 shadow-xs">
              <span className="flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium text-components-button-secondary-accent-text">
                <span className="me-1 i-ri-play-large-line size-4" />
                {t(($) => $['common.debugAndPreview'], { ns: 'workflow' })}
              </span>
              <span className="mx-0.5 h-3.5 w-px bg-divider-regular" />
              <span className="flex size-7 items-center justify-center rounded-md">
                <span className="i-custom-vender-line-time-clock-play size-4 text-components-button-ghost-text" />
              </span>
              <span className="ms-0.5 flex size-7 items-center justify-center rounded-md">
                <span className="i-ri-list-check-3 size-4 text-components-button-ghost-text" />
              </span>
            </div>
            <div className="flex shrink-0 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs backdrop-blur-[10px]">
              {[
                'i-custom-vender-line-others-bubble-x',
                'i-custom-vender-line-others-env',
                'i-custom-vender-line-others-global-variable',
              ].map((icon) => (
                <span
                  key={icon}
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-transparent p-1.5"
                >
                  <span className={`${icon} size-4 text-components-button-secondary-text`} />
                </span>
              ))}
            </div>
            <Button className="inset-ring-1 inset-ring-transparent dark:bg-white/10 dark:inset-ring-black/5 dark:backdrop-blur-xs">
              <span className="i-ri-apps-2-add-line size-4 text-components-button-secondary-text" />
              {t(($) => $['common.features'], { ns: 'workflow' })}
            </Button>
            <Button variant="primary" className="py-2 ps-3 pe-2">
              {t(($) => $['common.publish'], { ns: 'workflow' })}
              <span className="i-ri-arrow-down-s-line size-4 text-components-button-primary-text" />
            </Button>
            <span className="flex size-8 items-center justify-center rounded-lg bg-components-button-secondary-bg shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px] dark:bg-white/10">
              <span className="i-ri-history-line size-4 text-components-button-secondary-text" />
            </span>
          </div>
          <Button onClick={onExit}>{t(($) => $.exit)}</Button>
        </div>
      </div>
    </div>
  )
}

type DemoToolbarProps = {
  commentMode: boolean
  onCommentModeChange: (pressed: boolean) => void
  commentToolRef?: Ref<HTMLButtonElement>
}

export function DemoToolbar({
  commentMode,
  onCommentModeChange,
  commentToolRef,
}: DemoToolbarProps) {
  const { t } = useTranslation(['collaborationDemo'])
  const label = t(($) => $.commentTool)

  return (
    <div className="pointer-events-none absolute inset-y-0 inset-s-0 z-10 flex w-12 items-center justify-center p-1 ps-2">
      <div className="pointer-events-auto flex flex-col items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 text-text-tertiary shadow-lg">
        <div inert aria-hidden className="flex flex-col items-center">
          <ToolIcon icon="i-ri-add-circle-fill" />
          <ToolIcon icon="i-ri-sticky-note-add-line" />
          <ToolSeparator />
          <ToolIcon icon="i-ri-cursor-line" pressed={!commentMode} />
          <ToolIcon icon="i-ri-hand" />
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                pressed={commentMode}
                onPressedChange={onCommentModeChange}
                className="data-pressed:bg-state-accent-active data-pressed:text-text-accent"
                render={
                  <IconButton
                    ref={commentToolRef}
                    size="lg"
                    aria-label={label}
                    className="ms-px rounded-md"
                  >
                    <span aria-hidden className="i-custom-public-other-comment size-4" />
                  </IconButton>
                }
              />
            }
          />
          <TooltipContent sideOffset={4}>{label}</TooltipContent>
        </Tooltip>
        <div inert aria-hidden className="flex flex-col items-center">
          <ToolSeparator />
          <ToolIcon icon="i-ri-function-add-line" />
          <ToolIcon icon="i-ri-export-line" />
        </div>
      </div>
    </div>
  )
}

export function DemoEditorCanvasChrome() {
  const { t } = useTranslation(['workflowDebug'])
  const { zoom } = useViewport()

  return (
    <div inert aria-hidden className="absolute inset-x-0 bottom-0 z-10 px-1">
      <div className="flex justify-between px-1 pb-2">
        <div className="flex items-center space-x-0.5 rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 shadow-lg backdrop-blur-[5px]">
          <span className="inline-flex size-8 items-center justify-center p-1.5 text-text-disabled">
            <span className="i-ri-arrow-go-back-line size-4" />
          </span>
          <span className="inline-flex size-8 items-center justify-center p-1.5 text-text-disabled">
            <span className="i-ri-arrow-go-forward-fill size-4" />
          </span>
          <Separator decorative orientation="vertical" className="mx-0.5 h-3.5" />
          <span className="inline-flex size-8 items-center justify-center p-1.5 text-text-tertiary">
            <span className="i-ri-history-line size-4" />
          </span>
        </div>
        <div className="flex shrink-0 items-center">
          <span className="flex h-6 shrink-0 items-center gap-1 rounded-md border-[0.5px] border-effects-highlight bg-components-actionbar-bg px-2 system-2xs-semibold-uppercase text-text-tertiary shadow-lg backdrop-blur-xs">
            {t(($) => $['debug.variableInspect.trigger.normal'], { ns: 'workflowDebug' })}
          </span>
        </div>
        <div className="relative">
          <MiniMap
            style={{ width: 102, height: 72 }}
            maskColor="var(--color-workflow-minimap-bg)"
            nodeClassName="bg-workflow-minimap-block"
            nodeStrokeWidth={3}
            className="absolute! bottom-10! z-9 m-0! h-18.25! w-25.75! rounded-lg! border-[0.5px]! border-divider-subtle! bg-background-default-subtle! shadow-md! shadow-shadow-shadow-5!"
          />
          <div className="h-9 rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 text-[13px] shadow-lg backdrop-blur-[5px]">
            <div className="flex h-8 w-24.5 items-center justify-between rounded-lg">
              <span className="flex size-8 items-center justify-center rounded-lg">
                <span className="i-ri-zoom-out-line size-4 text-text-tertiary" />
              </span>
              <span className="flex h-8 w-8.5 items-center justify-center rounded-lg system-sm-medium text-text-tertiary">
                {Math.round(zoom * 100)}%
              </span>
              <span className="flex size-8 items-center justify-center rounded-lg">
                <span className="i-ri-zoom-in-line size-4 text-text-tertiary" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
