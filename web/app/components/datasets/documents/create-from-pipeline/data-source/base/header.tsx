import type { CredentialSelectorProps } from './credential-selector'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import Tooltip from '@/app/components/base/tooltip'
import CredentialSelector from './credential-selector'

type HeaderProps = {
  docTitle: string
  docLink: string
  onClickConfiguration?: () => void
  pluginName: string
} & CredentialSelectorProps

const Header = ({
  docTitle,
  docLink,
  onClickConfiguration,
  pluginName,
  ...rest
}: HeaderProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between gap-x-2">
      <div className="flex items-center gap-x-1 overflow-hidden">
        <CredentialSelector
          {...rest}
        />
        <Divider type="vertical" className="mx-1 h-3.5 shrink-0" />
        <Tooltip
          popupContent={t('configurationTip', { ns: 'datasetPipeline', pluginName })}
          position="top"
        >
          <Button
            variant="ghost"
            size="small"
            className="size-6 shrink-0 px-1"
          >
            <span className="i-ri-equalizer-2-line h-4 w-4" onClick={onClickConfiguration} />
          </Button>
        </Tooltip>
      </div>
      <a
        className="system-xs-medium flex shrink-0 items-center gap-x-1 text-text-accent"
        href={docLink}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="i-ri-book-open-line size-3.5 shrink-0" />
        <span title={docTitle}>{docTitle}</span>
      </a>
    </div>
  )
}

export default React.memo(Header)
