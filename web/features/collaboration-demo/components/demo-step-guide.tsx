'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Popover,
  PopoverArrow,
  PopoverDescription,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
} from '@langgenius/dify-ui/popover'
import { useTranslation } from 'react-i18next'

type DemoStepGuideProps = {
  target: HTMLElement | null
  side: 'inline-start' | 'inline-end'
  step: 1 | 2
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}

export function DemoStepGuide({
  target,
  side,
  step,
  title,
  description,
  actionLabel,
  onAction,
}: DemoStepGuideProps) {
  const { t } = useTranslation(['collaborationDemo'])

  return (
    <Popover open={!!target} modal={false}>
      <PopoverPortal>
        <PopoverPositioner
          anchor={target}
          side={side}
          align="start"
          sideOffset={12}
          collisionPadding={8}
        >
          <PopoverPopup
            initialFocus={false}
            finalFocus={false}
            className="w-80 rounded-2xl border-[0.5px] border-state-accent-hover-alt bg-state-accent-hover p-4 shadow-xl"
          >
            <PopoverArrow className="size-3 rotate-45 border-state-accent-hover-alt bg-state-accent-hover data-[side=inline-end]:-inset-s-1.5 data-[side=inline-end]:border-s-[0.5px] data-[side=inline-end]:border-b-[0.5px] data-[side=inline-start]:-inset-e-1.5 data-[side=inline-start]:border-e-[0.5px] data-[side=inline-start]:border-t-[0.5px]" />
            <div className="system-2xs-semibold-uppercase text-text-tertiary">
              {t(($) => $['steps.label'], { current: step, total: 2 })}
            </div>
            <PopoverTitle className="mt-1 system-md-medium text-text-primary">{title}</PopoverTitle>
            <PopoverDescription className="mt-1 system-xs-regular text-text-secondary">
              {description}
            </PopoverDescription>
            <div className="mt-4 flex justify-end">
              <Button variant="primary" className="min-w-20" onClick={onAction}>
                {actionLabel}
              </Button>
            </div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  )
}
