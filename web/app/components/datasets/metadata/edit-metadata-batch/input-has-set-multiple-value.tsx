'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  fieldId: string
  onClear: () => void
  readOnly?: boolean
}>

const InputHasSetMultipleValue: FC<Props> = ({ fieldId, onClear, readOnly }) => {
  const { t } = useTranslation(['dataset', 'common'])
  const clearId = useId()
  return (
    <div className="h-6 grow rounded-md bg-components-input-bg-normal text-[0]">
      <div
        className={cn(
          'inline-flex h-6 items-center space-x-0.5 rounded-[5px] border-[0.5px] border-components-panel-border bg-components-badge-white-to-dark pr-0.5 pl-1.5 shadow-xs',
          readOnly && 'pr-1.5',
        )}
      >
        <div className="system-xs-regular text-text-secondary">
          {t(($) => $['metadata.batchEditMetadata.multipleValue'], { ns: 'dataset' })}
        </div>
        {!readOnly && (
          <>
            <span id={clearId} className="sr-only">
              {t(($) => $['operation.clear'], { ns: 'common' })}
            </span>
            <IconButton aria-labelledby={`${clearId} ${fieldId}`} onClick={onClear}>
              <span className="i-ri-close-line size-3.5" aria-hidden="true" />
            </IconButton>
          </>
        )}
      </div>
    </div>
  )
}
export default React.memo(InputHasSetMultipleValue)
