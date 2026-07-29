import { Button } from '@langgenius/dify-ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useNewKnowledgeGuideDismissedValue,
  useSetNewKnowledgeGuideDismissed,
} from '@/features/new-rag/storage'

export type KnowledgeViewSwitcherProps = {
  value: 'legacy' | 'new'
  onChange: (value: 'legacy' | 'new') => void
}

export function KnowledgeViewSwitcher({ value, onChange }: KnowledgeViewSwitcherProps) {
  const { t } = useTranslation('dataset')
  const guideDismissed = useNewKnowledgeGuideDismissedValue()
  const setGuideDismissed = useSetNewKnowledgeGuideDismissed()
  const [guideOpenOverride, setGuideOpenOverride] = useState<boolean | null>(null)
  const guideOpen = guideOpenOverride ?? !guideDismissed

  const dismissGuide = () => {
    setGuideDismissed(true)
    setGuideOpenOverride(false)
  }

  return (
    <div className="relative max-w-full shrink-0">
      <SegmentedControl
        className="max-w-full rounded-md p-px"
        aria-label={t(($) => $['newKnowledge.viewLabel'])}
        value={[value]}
        onValueChange={(values) => {
          const nextValue = values[0]
          if (nextValue === 'legacy' || nextValue === 'new') onChange(nextValue)
        }}
      >
        <SegmentedControlItem
          className="h-[22px] rounded-md px-1 py-px system-xs-medium"
          value="legacy"
        >
          {t(($) => $['newKnowledge.legacy'])}
        </SegmentedControlItem>
        <SegmentedControlItem
          className="h-[22px] rounded-md py-px pr-5 pl-1 system-xs-medium"
          value="new"
        >
          {t(($) => $['newKnowledge.new'])}
        </SegmentedControlItem>
      </SegmentedControl>
      <Popover open={guideOpen} onOpenChange={setGuideOpenOverride}>
        <PopoverTrigger
          aria-label={t(($) => $['newKnowledge.guideTitle'])}
          render={
            <button
              type="button"
              className="absolute top-[5px] right-1 z-10 flex size-3.5 items-center justify-center rounded-sm text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              <span aria-hidden className="i-ri-question-line size-3.5" />
            </button>
          }
        />
        <PopoverContent
          placement="bottom"
          sideOffset={13}
          popupClassName="relative flex max-h-[calc(100dvh-2rem)] min-h-[162px] w-80 max-w-[calc(100vw-2rem)] flex-col"
        >
          <span
            aria-hidden
            className="absolute -top-[9.59px] left-1/2 flex size-[19.456px] -translate-x-1/2 items-center justify-center"
          >
            <span className="size-[13.757px] -rotate-45 rounded-tr-[2px] border-t border-r border-divider-subtle bg-components-panel-bg" />
          </span>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-3.5 pb-4">
            <PopoverTitle className="system-md-medium text-text-primary">
              {t(($) => $['newKnowledge.guideTitle'])}
            </PopoverTitle>
            <PopoverDescription className="mt-2 system-sm-regular text-text-secondary">
              {t(($) => $['newKnowledge.guideDescription'])}
            </PopoverDescription>
            <div className="mt-auto flex flex-wrap items-center justify-end gap-3 pt-3">
              <a
                href="https://docs.dify.ai/en/guides/knowledge-base"
                target="_blank"
                rel="noreferrer"
                className="rounded-sm system-xs-regular text-text-accent outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              >
                {t(($) => $['newKnowledge.learnMore'])}
              </a>
              <Button variant="primary" size="small" onClick={dismissGuide}>
                {t(($) => $['newKnowledge.gotIt'])}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
