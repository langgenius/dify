'use client'

import type { CommandOption } from '../command-options'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'

type ContextTokenProps = Pick<CommandOption, 'title'> & {
  onRemove: () => void
}

export function ContextToken({ title, onRemove }: ContextTokenProps) {
  const { t } = useTranslation(['common'])

  return (
    <span className="inline-flex h-6 max-w-40 shrink-0 items-center gap-0.5 rounded-md bg-state-accent-hover ps-1.5 pe-0.5 system-xs-medium text-text-accent">
      <span className="truncate">{title}</span>
      <IconButton
        size="sm"
        tabIndex={-1}
        aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
        onClick={onRemove}
      >
        <span aria-hidden className="i-ri-close-line size-3.5" />
      </IconButton>
    </span>
  )
}
