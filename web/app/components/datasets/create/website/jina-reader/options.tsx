'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import CheckboxWithLabel from '../base/checkbox-with-label'
import Field from '../base/field'
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
        label={t(`${I18N_PREFIX}.crawlSubPage`)}
        isChecked={payload.crawl_sub_pages}
        onChange={handleChange('crawl_sub_pages')}
      />
      <CheckboxWithLabel
        label={t(`${I18N_PREFIX}.useSitemap`)}
        isChecked={payload.use_sitemap}
        onChange={handleChange('use_sitemap')}
        tooltip={t(`${I18N_PREFIX}.useSitemapTooltip`) as string}
      />
      <div className='flex justify-between space-x-4'>
        <Field
          className='grow shrink-0'
          label={t(`${I18N_PREFIX}.limit`)}
          value={payload.limit}
          onChange={handleChange('limit')}
          isNumber
          isRequired
        />
      </div>
    </div>
  )
}
export default React.memo(Options)
