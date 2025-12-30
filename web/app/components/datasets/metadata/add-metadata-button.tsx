'use client'
import type { FC } from 'react'
import { RiAddLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import Button from '../../base/button'

type Props = {
  className?: string
  onClick?: () => void
}

const AddedMetadataButton: FC<Props> = ({
  className,
  onClick,
}) => {
  const { t } = useTranslation()
  return (
    <Button
      className={cn('flex w-full items-center', className)}
      size="small"
      variant="tertiary"
      onClick={onClick}
    >
      <RiAddLine className="mr-1 size-3.5" />
      <div>{t('metadata.addMetadata', { ns: 'dataset' })}</div>
    </Button>
  )
}
export default React.memo(AddedMetadataButton)
