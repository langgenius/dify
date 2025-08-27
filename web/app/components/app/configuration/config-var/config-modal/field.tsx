'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import { useTranslation } from 'react-i18next'

type Props = {
  className?: string
  title: string
  isOptional?: boolean
  children: React.JSX.Element
}

const Field: FC<Props> = ({
  className,
  title,
  isOptional,
  children,
}) => {
  const { t } = useTranslation()
  return (
    <div className={cn(className)}>
      <div className='system-sm-semibold leading-8 text-text-secondary'>
        {title}
        {isOptional && <span className='system-xs-regular ml-1 text-text-tertiary'>({t('appDebug.variableConfig.optional')})</span>}
      </div>
      <div>{children}</div>
    </div>
  )
}
export default React.memo(Field)
