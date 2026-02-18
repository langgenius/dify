'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { useDocLink } from '@/context/i18n'
import Input from '../../base/input'

const I18N_PREFIX = 'stepOne.website'

type Props = {
  isRunning: boolean
  onRun: (url: string) => void
}

const UrlInput: FC<Props> = ({
  isRunning,
  onRun,
}) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
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
    <div className="flex items-center justify-between">
      <Input
        value={url}
        onChange={handleUrlChange}
        placeholder={docLink()}
      />
      <Button
        variant="primary"
        onClick={handleOnRun}
        className="ml-2"
        loading={isRunning}
        data-testid="url-input-run-button"
      >
        {!isRunning ? t(`${I18N_PREFIX}.run`, { ns: 'datasetCreation' }) : ''}
      </Button>
    </div>
  )
}
export default React.memo(UrlInput)
