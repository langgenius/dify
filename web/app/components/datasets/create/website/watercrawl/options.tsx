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
        labelClassName='text-[13px] leading-[16px] font-medium text-text-secondary'
      />
      <div className='flex justify-between space-x-4'>
        <Field
          className='shrink-0 grow'
          label={t(`${I18N_PREFIX}.limit`)}
          value={payload.limit}
          onChange={handleChange('limit')}
          isNumber
          isRequired
        />
        <Field
          className='shrink-0 grow'
          label={t(`${I18N_PREFIX}.maxDepth`)}
          value={payload.max_depth}
          onChange={handleChange('max_depth')}
          isNumber
          tooltip={t(`${I18N_PREFIX}.maxDepthTooltip`)!}
        />
      </div>

      <div className='flex justify-between space-x-4'>
        <Field
          className='shrink-0 grow'
          label={t(`${I18N_PREFIX}.excludePaths`)}
          value={payload.excludes}
          onChange={handleChange('excludes')}
          placeholder='blog/*, /about/*'
        />
        <Field
          className='shrink-0 grow'
          label={t(`${I18N_PREFIX}.includeOnlyPaths`)}
          value={payload.includes}
          onChange={handleChange('includes')}
          placeholder='articles/*'
        />
      </div>
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
