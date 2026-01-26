'use client'
import type { FC } from 'react'
import { RiDownloadLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import { cn } from '@/utils/classnames'
import { downloadCSV } from '@/utils/csv'

export type IResDownloadProps = {
  isMobile: boolean
  values: Record<string, string>[]
}

const ResDownload: FC<IResDownloadProps> = ({
  isMobile,
  values,
}) => {
  const { t } = useTranslation()

  const handleDownload = () => {
    downloadCSV(values, 'result', { bom: true })
  }

  return (
    <button
      type="button"
      className="block cursor-pointer"
      onClick={handleDownload}
    >
      {isMobile && (
        <ActionButton>
          <RiDownloadLine className="h-4 w-4" />
        </ActionButton>
      )}
      {!isMobile && (
        <Button className={cn('space-x-1')}>
          <RiDownloadLine className="h-4 w-4" />
          <span>{t('operation.download', { ns: 'common' })}</span>
        </Button>
      )}
    </button>
  )
}
export default React.memo(ResDownload)
