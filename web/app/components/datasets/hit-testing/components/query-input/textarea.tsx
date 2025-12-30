import type { ChangeEvent } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Corner } from '@/app/components/base/icons/src/vender/solid/shapes'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'

type TextareaProps = {
  text: string
  handleTextChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
}

const Textarea = ({
  text,
  handleTextChange,
}: TextareaProps) => {
  const { t } = useTranslation()

  return (
    <div className={cn(
      'relative flex-1 overflow-hidden rounded-t-[10px] border-t-[0.5px] border-components-panel-border-subtle bg-background-default px-4 pb-0 pt-3',
      text.length > 200 && 'border-state-destructive-active',
    )}
    >
      <textarea
        className="system-md-regular h-full w-full resize-none border-none bg-transparent text-text-secondary caret-[#295EFF] placeholder:text-components-input-text-placeholder focus-visible:outline-none"
        value={text}
        onChange={handleTextChange}
        placeholder={t('input.placeholder', { ns: 'datasetHitTesting' }) as string}
      />
      <div className="absolute right-0 top-0 flex items-center">
        <Corner className={cn(
          'text-background-section-burn',
          text.length > 200 && 'text-util-colors-red-red-100',
        )}
        />
        {text.length > 200
          ? (
              <Tooltip
                popupContent={t('input.countWarning', { ns: 'datasetHitTesting' })}
              >
                <div
                  className={cn('system-2xs-medium-uppercase bg-util-colors-red-red-100 py-1 pr-2 text-util-colors-red-red-600')}
                >
                  {`${text.length}/200`}
                </div>
              </Tooltip>
            )
          : (
              <div
                className={cn(
                  'system-2xs-medium-uppercase bg-background-section-burn py-1 pr-2 text-text-tertiary',
                )}
              >
                {`${text.length}/200`}
              </div>
            )}
      </div>
    </div>
  )
}

export default React.memo(Textarea)
