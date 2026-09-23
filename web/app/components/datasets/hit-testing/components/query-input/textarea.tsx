import type { ChangeEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type TextareaProps = {
  id: string
  text: string
  handleTextChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
  showFocusRing: boolean
  onPointerDown: () => void
  onBlur: () => void
}

const Textarea = ({
  id,
  text,
  handleTextChange,
  showFocusRing,
  onPointerDown,
  onBlur,
}: TextareaProps) => {
  const { t } = useTranslation(['datasetHitTesting'])
  const isOverLimit = text.length > 200
  const errorId = `${id}-error`

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[10px] border-t-[0.5px] border-components-panel-border-subtle bg-background-default px-4 pt-3 pb-0',
        isOverLimit && 'border-state-destructive-active',
      )}
    >
      <textarea
        id={id}
        aria-invalid={isOverLimit || undefined}
        aria-describedby={isOverLimit ? errorId : undefined}
        className={cn(
          'min-h-0 w-full flex-1 resize-none border-none bg-transparent system-md-regular text-text-secondary caret-[#295EFF] placeholder:text-components-input-text-placeholder',
          showFocusRing
            ? 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-state-accent-solid'
            : 'outline-none',
        )}
        value={text}
        onChange={handleTextChange}
        onPointerDown={onPointerDown}
        onBlur={onBlur}
        placeholder={t(($) => $['input.placeholder'], { ns: 'datasetHitTesting' }) as string}
      />
      <div className="absolute top-0 right-0 flex items-center">
        <span
          aria-hidden
          className={cn(
            'i-custom-vender-solid-shapes-corner h-5 w-3.25',
            cn('text-background-section-burn', isOverLimit && 'text-util-colors-red-red-100'),
          )}
        />
        {isOverLimit ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <div className="bg-util-colors-red-red-100 py-1 pr-2 system-2xs-medium-uppercase text-util-colors-red-red-600">
                  {`${text.length}/200`}
                </div>
              }
            />
            <TooltipContent>
              {t(($) => $['input.countWarning'], { ns: 'datasetHitTesting' })}
            </TooltipContent>
          </Tooltip>
        ) : (
          <div className="bg-background-section-burn py-1 pr-2 system-2xs-medium-uppercase text-text-tertiary">
            {`${text.length}/200`}
          </div>
        )}
      </div>
      <div
        id={errorId}
        role="alert"
        aria-atomic="true"
        className="shrink-0 system-xs-regular text-util-colors-red-red-600"
      >
        {isOverLimit ? t(($) => $['input.countWarning'], { ns: 'datasetHitTesting' }) : null}
      </div>
    </div>
  )
}

export default React.memo(Textarea)
