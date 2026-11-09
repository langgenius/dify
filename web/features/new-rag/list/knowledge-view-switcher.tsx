import { Button } from '@langgenius/dify-ui/button'
import {
  Popover,
  PopoverArrow,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useIsClient } from 'foxact/use-is-client'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import {
  useNewKnowledgeGuideDismissedValue,
  useSetNewKnowledgeGuideDismissed,
} from '@/features/new-rag/list/storage'

export type KnowledgeViewSwitcherProps = {
  value: 'classic' | 'agent'
  onChange: (value: 'classic' | 'agent') => void
}

export function KnowledgeViewSwitcher({ value, onChange }: KnowledgeViewSwitcherProps) {
  const { t } = useTranslation(['knowledgeSpace', 'dataset'])
  const docLink = useDocLink()
  const guideDismissed = useNewKnowledgeGuideDismissedValue()
  const setGuideDismissed = useSetNewKnowledgeGuideDismissed()
  const isClient = useIsClient()
  const [guideOpenOverride, setGuideOpenOverride] = useState<boolean | null>(null)
  const gotItRef = useRef<HTMLButtonElement>(null)
  const guideOpen = isClient && (guideOpenOverride ?? !guideDismissed)

  const dismissGuide = () => {
    setGuideDismissed(true)
    setGuideOpenOverride(false)
  }

  return (
    <div className="relative flex max-w-full shrink-0">
      <SegmentedControl
        className="max-w-full rounded-md p-px"
        aria-label={t(($) => $.viewLabel)}
        value={value}
        onValueChange={(value) => onChange(value)}
      >
        <SegmentedControlItem
          className="h-5.5 rounded-md px-1 py-px system-xs-medium"
          value="classic"
        >
          {t(($) => $['view.classic'])}
        </SegmentedControlItem>
        <SegmentedControlItem
          className="h-5.5 rounded-md py-px pr-5 pl-1 system-xs-medium"
          value="agent"
        >
          {t(($) => $['view.agent'])}
          <span className="ml-1 inline-flex items-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-px system-2xs-medium-uppercase text-text-tertiary">
            {t(($) => $['view.beta'])}
          </span>
        </SegmentedControlItem>
      </SegmentedControl>
      <Popover open={guideOpen} onOpenChange={setGuideOpenOverride}>
        <PopoverTrigger
          aria-label={t(($) => $.guideTitle)}
          render={
            <button
              type="button"
              className="absolute top-1.25 right-1 z-10 flex size-3.5 items-center justify-center rounded-sm text-text-tertiary hover:text-text-secondary"
            >
              <span aria-hidden className="i-ri-question-line size-3.5" />
            </button>
          }
        />
        <PopoverContent
          sideOffset={13}
          initialFocus={guideOpenOverride ? gotItRef : false}
          className="relative flex max-h-[calc(100dvh-2rem)] min-h-40.5 w-80 max-w-[calc(100vw-2rem)] flex-col"
        >
          <PopoverArrow className="h-[9.728px] w-[19.456px] overflow-clip data-[side=bottom]:top-[-9.728px] data-[side=top]:bottom-[-9.728px] data-[side=top]:rotate-180">
            <span className="absolute bottom-0 left-1/2 size-[13.757px] -translate-x-1/2 translate-y-1/2 -rotate-45 rounded-tr-xs border-t border-r border-divider-subtle bg-components-panel-bg" />
          </PopoverArrow>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-3.5 pb-4">
            <PopoverTitle className="system-md-medium text-text-primary">
              {t(($) => $.guideTitle)}
            </PopoverTitle>
            <PopoverDescription className="mt-2 system-sm-regular text-text-secondary">
              {t(($) => $.guideDescription)}
            </PopoverDescription>
            <div className="mt-auto flex flex-wrap items-center justify-end gap-3 pt-3">
              <a
                href={docLink('/cloud/use-dify/knowledge-base/overview')}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm system-xs-regular text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              >
                {t(($) => $.learnMore)}
              </a>
              <Button ref={gotItRef} variant="primary" size="small" onClick={dismissGuide}>
                {t(($) => $.gotIt)}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
