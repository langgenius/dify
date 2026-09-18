'use client'
import type { FC } from 'react'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  className?: string
  onClick: (e: React.MouseEvent) => void
}>

const Remove: FC<Props> = ({ onClick }) => {
  const { t } = useTranslation()
  return (
    <IconButton
      aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
      size="lg"
      tone="destructive"
      className="shrink-0"
      onClick={onClick}
    >
      <span aria-hidden="true" className="i-ri-delete-bin-line size-4" />
    </IconButton>
  )
}
export default React.memo(Remove)
