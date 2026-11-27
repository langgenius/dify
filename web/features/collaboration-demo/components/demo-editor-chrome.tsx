'use client'

import type { Ref } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Separator } from '@langgenius/dify-ui/separator'
import { Toggle } from '@langgenius/dify-ui/toggle'
import { useTranslation } from 'react-i18next'
import TipPopup from '@/app/components/workflow/operator/tip-popup'
import {
  toolbarClassName,
  toolbarModeToggleClassName,
} from '@/app/components/workflow/operator/toolbar-styles'
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

function DemoTool({
  icon,
  label,
  pressed = false,
  className,
}: {
  icon: string
  label: string
  pressed?: boolean
  className?: string
}) {
  return (
    <Toggle
      pressed={pressed}
      className={toolbarModeToggleClassName}
      render={
        <IconButton size="lg" aria-label={label} className={cn('rounded-md', className)}>
          <span aria-hidden className={cn(icon, 'size-4')} />
        </IconButton>
      }
    />
  )
}

/**
 * The editor's Toolbar, in its place and order. Only the comment tool works here; the other
 * tools are inert so the Toolbar reads like the editor's without offering modes the demo cannot
 * switch to.
 */
export function DemoToolbar({
  commentMode,
  onCommentModeChange,
  commentToolRef,
}: DemoToolbarProps) {
  const { t } = useTranslation(['collaborationDemo', 'workflow'])
  const label = t(($) => $.commentTool)

  return (
    <div className="pointer-events-none absolute inset-y-0 inset-s-0 z-10 flex w-12 items-center justify-center p-1 ps-2">
      <div className={cn('pointer-events-auto', toolbarClassName)}>
        <div inert aria-hidden className="flex flex-col items-center">
          <DemoTool
            icon="i-ri-add-circle-fill"
            label={t(($) => $['common.addBlock'], { ns: 'workflow' })}
          />
          <DemoTool
            icon="i-ri-sticky-note-add-line"
            label={t(($) => $['nodes.note.addNote'], { ns: 'workflow' })}
            className="ms-px"
          />
          <Separator className="my-1 h-[0.5px] w-3.5" />
          <DemoTool
            icon="i-ri-cursor-line"
            label={t(($) => $['common.pointerMode'], { ns: 'workflow' })}
            className="me-px"
            pressed={!commentMode}
          />
          <DemoTool icon="i-ri-hand" label={t(($) => $['common.handMode'], { ns: 'workflow' })} />
        </div>
        <TipPopup title={label}>
          <Toggle
            pressed={commentMode}
            onPressedChange={onCommentModeChange}
            className={toolbarModeToggleClassName}
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
        </TipPopup>
        <div inert aria-hidden className="flex flex-col items-center">
          <Separator className="my-1 h-[0.5px] w-3.5" />
          <DemoTool
            icon="i-ri-function-add-line"
            label={t(($) => $['panel.organizeBlocks'], { ns: 'workflow' })}
          />
          <DemoTool
            icon="i-ri-export-line"
            label={t(($) => $['common.exportImage'], { ns: 'workflow' })}
          />
        </div>
      </div>
    </div>
  )
}
