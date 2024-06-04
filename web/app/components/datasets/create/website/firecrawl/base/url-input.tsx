'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from './input'
import Button from '@/app/components/base/button'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

type Props = {
  onRun: (url: string) => void
}

const UrlInput: FC<Props> = ({
  onRun,
}) => {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')

  const handleOnRun = useCallback(() => {
    onRun(url)
  }, [onRun, url])

  return (
    <div className='flex items-center justify-between'>
      <Input
        value={url}
        onChange={setUrl}
        placeholder='https://docs.dify.ai'
      />
      <Button
        type='primary'
        onClick={handleOnRun}
        className='ml-2 !h-8 text-[13px] font-medium'
      >
        {t(`${I18N_PREFIX}.run`)}
      </Button>
    </div>
  )
}
export default React.memo(UrlInput)
