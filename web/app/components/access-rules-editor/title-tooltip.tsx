import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'

type TitleTooltipProps = {
  content: string
}

export default function TitleTooltip({ content }: TitleTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <button
            type="button"
            aria-label={content}
            className="flex size-4 shrink-0 items-center justify-center rounded-sm text-text-quaternary outline-hidden hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            <span className="i-ri-question-line size-3.5" aria-hidden />
          </button>
        )}
      />
      <TooltipContent className="max-w-64 system-xs-regular text-text-secondary">
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
