'use client'
import type { FC } from 'react'
import { RiAddLine } from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import SearchInput from '@/app/components/base/search-input'
import { cn } from '@/utils/classnames'

const SidebarSearchAdd: FC = () => {
  const [value, setValue] = useState('')
  const { t } = useTranslation()

  return (
    <div
      className="flex items-center gap-1 bg-components-panel-bg p-2"
      data-component="sidebar-search-add"
    >
      <SearchInput
        value={value}
        onChange={setValue}
        className="h-8 flex-1"
      />
      <Button
        variant="primary"
        size="medium"
        className={cn('!h-8 !w-8 !px-0')}
        aria-label={t('operation.add', { ns: 'common' })}
      >
        <RiAddLine className="h-4 w-4" />
      </Button>
    </div>
  )
}

export default React.memo(SidebarSearchAdd)
