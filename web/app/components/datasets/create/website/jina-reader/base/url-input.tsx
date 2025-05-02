'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from './input'
import Button from '@/app/components/base/button'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

type Props = {
  isRunning: boolean
  onRun: (url: string) => void
}

const UrlInput: FC<Props> = ({
  isRunning,
  onRun,
}) => {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const handleUrlChange = useCallback((url: string | number) => {
    setUrl(url as string)
  }, [])
  const handleOnRun = useCallback(() => {
    if (isRunning)
      return
    onRun(url)
  }, [isRunning, onRun, url])

  return (
    <div className='flex items-center justify-between'>
      <Input
        value={url}
        onChange={handleUrlChange}
        placeholder='https://docs.dify.ai'
      />
      <Button
        variant='primary'
        onClick={handleOnRun}
        className='ml-2'
        loading={isRunning}
      >
        {!isRunning ? t(`${I18N_PREFIX}.run`) : ''}
      </Button>
    </div>
  )
}
export default React.memo(UrlInput)
