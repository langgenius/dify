'use client'
import type { FC } from 'react'
import type { CrawlOptions } from '@/models/datasets'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import CheckboxWithLabel from '../base/checkbox-with-label'
import Field from '../base/field'

const I18N_PREFIX = 'stepOne.website'

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
        label={t(`${I18N_PREFIX}.crawlSubPage`, { ns: 'datasetCreation' })}
        isChecked={payload.crawl_sub_pages}
        onChange={handleChange('crawl_sub_pages')}
        labelClassName="text-[13px] leading-[16px] font-medium text-text-secondary"
        testId="crawl-sub-pages"
      />
      <CheckboxWithLabel
        label={t(`${I18N_PREFIX}.useSitemap`, { ns: 'datasetCreation' })}
        isChecked={payload.use_sitemap}
        onChange={handleChange('use_sitemap')}
        tooltip={t(`${I18N_PREFIX}.useSitemapTooltip`, { ns: 'datasetCreation' }) as string}
        labelClassName="text-[13px] leading-[16px] font-medium text-text-secondary"
        testId="use-sitemap"
      />
      <div className="flex justify-between space-x-4">
        <Field
          className="shrink-0 grow"
          label={t(`${I18N_PREFIX}.limit`, { ns: 'datasetCreation' })}
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
