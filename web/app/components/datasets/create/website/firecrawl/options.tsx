'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import cn from 'classnames'
import CheckboxWithLabel from './base/checkbox-with-label'
import Field from './base/field'
import type { CrawlOptions } from '@/models/datasets'

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
      <CheckboxWithLabel label='Crawl subdomains' isChecked={payload.crawl_sub_pages} onChange={handleChange('crawl_sub_pages')} />
      <div className='flex justify-between space-x-4'>
        <Field
          className='grow shrink-0'
          label='Limit'
          value={payload.limit}
          onChange={handleChange('limit')}
          isNumber
          isRequired
        />
        <Field
          className='grow shrink-0'
          label='Max depth'
          value={payload.max_depth}
          onChange={handleChange('max_depth')}
          isNumber
          isRequired
        />
      </div>

      <div className='flex justify-between space-x-4'>
        <Field
          className='grow shrink-0'
          label='Exclude paths'
          value={payload.excludes}
          onChange={handleChange('excludes')}
          placeholder='blog/*, /about/*'
        />
        <Field
          className='grow shrink-0'
          label='Include only paths'
          value={payload.includes}
          onChange={handleChange('includes')}
          isNumber
          placeholder='articles/*'
        />
      </div>
      <CheckboxWithLabel label='Extract only main content (no headers, navs, footers, etc.)' isChecked={payload.only_main_content} onChange={handleChange('only_main_content')} />
    </div>
  )
}
export default React.memo(Options)
