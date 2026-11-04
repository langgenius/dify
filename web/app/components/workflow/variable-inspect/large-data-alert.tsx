'use client'
import type { FC } from 'react'
import { Alert, AlertTitle } from '@langgenius/dify-ui/alert'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  textHasNoExport?: boolean
  downloadUrl?: string
  className?: string
}>

const LargeDataAlert: FC<Props> = ({ textHasNoExport, downloadUrl, className }) => {
  const { t } = useTranslation(['workflowDebug'])
  return (
    <Alert type="info" className={className}>
      <AlertTitle>
        {textHasNoExport
          ? t(($) => $['debug.variableInspect.largeDataNoExport'], { ns: 'workflowDebug' })
          : t(($) => $['debug.variableInspect.largeData'], { ns: 'workflowDebug' })}
      </AlertTitle>
      {downloadUrl && (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start system-xs-medium-uppercase text-text-accent"
        >
          {t(($) => $['debug.variableInspect.export'], { ns: 'workflowDebug' })}
        </a>
      )}
    </Alert>
  )
}
export default React.memo(LargeDataAlert)
