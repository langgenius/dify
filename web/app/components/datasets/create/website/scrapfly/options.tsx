'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import CheckboxWithLabel from '../base/checkbox-with-label'
import cn from '@/utils/classnames'
import type { CrawlOptions } from '@/models/datasets'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

type Props = {
  className?: string
  payload: CrawlOptions
  onChange: (payload: CrawlOptions) => void
}

const Options: FC<Props> = ({
  className = '',
  payload,
  onChange,
}) => {
  const { t } = useTranslation()

  const handleChange = useCallback((key: keyof CrawlOptions) => {
    return (value: any) => {
      onChange({
        ...payload,
        [key]: value,
      })
    }
  }, [payload, onChange])

  return (
    <div className={cn(className, ' space-y-2')}>
      <CheckboxWithLabel
        label={t(`${I18N_PREFIX}.enableJSRendering`)}
        isChecked={payload.render_js || false}
        onChange={handleChange('render_js')}
        labelClassName='text-[13px] leading-[16px] font-medium text-text-secondary'
      />
      <CheckboxWithLabel
        label={t(`${I18N_PREFIX}.antiScrapingProtection`)}
        isChecked={payload.asp || true}
        onChange={handleChange('asp')}
        labelClassName='text-[13px] leading-[16px] font-medium text-text-secondary'
      />
      <CheckboxWithLabel
        label={t(`${I18N_PREFIX}.extractOnlyMainContent`)}
        isChecked={payload.only_main_content}
        onChange={handleChange('only_main_content')}
        labelClassName='text-[13px] leading-[16px] font-medium text-text-secondary'
      />
    </div>
  )
}
export default React.memo(Options)
