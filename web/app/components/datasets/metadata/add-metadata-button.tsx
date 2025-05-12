'use client'
import type { FC } from 'react'
import React from 'react'
import Button from '../../base/button'
import { RiAddLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import { useTranslation } from 'react-i18next'

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
      size='small'
      variant='tertiary'
      onClick={onClick}
    >
      <RiAddLine className='mr-1 size-3.5' />
      <div>{t('dataset.metadata.addMetadata')}</div>
    </Button>
  )
}
export default React.memo(AddedMetadataButton)
