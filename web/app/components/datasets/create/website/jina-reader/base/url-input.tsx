'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'

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
  const handleOnRun = useCallback(() => {
    if (isRunning)
      return
    onRun(url)
  }, [isRunning, onRun, url])

  return (
    <div className="flex items-center justify-between">
      <Input
        value={url}
        onValueChange={setUrl}
        placeholder={docLink()}
        size="small"
      />
      <Button
        variant="primary"
        onClick={handleOnRun}
        className="ml-2"
        loading={isRunning}
        aria-label={t(`${I18N_PREFIX}.run`, { ns: 'datasetCreation' })}
      >
        {!isRunning ? t(`${I18N_PREFIX}.run`, { ns: 'datasetCreation' }) : ''}
      </Button>
    </div>
  )
}
export default React.memo(UrlInput)
