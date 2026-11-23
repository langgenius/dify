'use client'

import type { Ref } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Toggle } from '@langgenius/dify-ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { MiniMap, useViewport } from 'reactflow'
import { useDemoViewport } from '../demo-viewport'
import { DemoMembers } from './demo-members'

type DemoHeaderProps = {
  membersListed: boolean
  membersRef: (element: HTMLElement | null) => void
  onExit: () => void
}

export function DemoHeader({ membersListed, membersRef, onExit }: DemoHeaderProps) {
  const { t } = useTranslation(['collaborationDemo'])

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-between gap-3 px-3">
      <h1 className="system-sm-semibold whitespace-nowrap text-text-primary">
        {t(($) => $.title)}
      </h1>
      <div className="flex items-center gap-2">
        <DemoMembers listed={membersListed} pillRef={membersRef} />
        <Button onClick={onExit}>{t(($) => $.exit)}</Button>
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
    <div className="absolute inset-s-2 top-14 z-10 flex flex-col items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 text-text-tertiary shadow-lg">
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
                  className="rounded-md"
                >
                  <span aria-hidden className="i-custom-public-other-comment size-4" />
                </IconButton>
              }
            />
          }
        />
        <TooltipContent side="right" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export function DemoCanvasCorner() {
  const { zoom } = useViewport()
  useDemoViewport()

  return (
    <div inert aria-hidden className="absolute inset-e-2 bottom-2 z-10">
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
  )
}
