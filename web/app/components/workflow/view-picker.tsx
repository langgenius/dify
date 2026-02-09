'use client'

import type { FC } from 'react'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SegmentedControl from '@/app/components/base/segmented-control'
import { cn } from '@/utils/classnames'
import { ViewType } from '../workflow/types'

type ViewPickerProps = {
  value: ViewType
  onChange: (value: ViewType) => void
  className?: string
}

const ViewPicker: FC<ViewPickerProps> = ({
  value,
  onChange,
  className,
}) => {
  const { t } = useTranslation()
  const options = useMemo(() => ([
    { value: ViewType.graph, text: t('viewPicker.graph', { ns: 'workflow' }) },
    { value: ViewType.skill, text: t('viewPicker.skill', { ns: 'workflow' }) },
  ]), [t])

  const handleChange = useCallback((nextValue: string | number | symbol) => {
    if (nextValue === value)
      return
    onChange(nextValue as ViewType)
  }, [onChange, value])

  return (
    <SegmentedControl
      className={cn('text-text-accent-light-mode-only', className)}
      options={options}
      value={value}
      onChange={handleChange}
      btnClassName="system-sm-semibold-uppercase text-text-secondary"
      activeClassName="!text-text-accent-light-mode-only"
      size="regular"
      padding="none"
    />
  )
}

export default React.memo(ViewPicker)
