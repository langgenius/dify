import type { CredentialSelectorProps } from './credential-selector'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Separator } from '@langgenius/dify-ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import CredentialSelector from './credential-selector'

type HeaderProps = {
  docTitle: string
  docLink: string
  onClickConfiguration?: () => void
  pluginName: string
} & CredentialSelectorProps

const Header = ({ docTitle, docLink, onClickConfiguration, pluginName, ...rest }: HeaderProps) => {
  const { t } = useTranslation()
  const configurationTip = t(($) => $.configurationTip, { ns: 'datasetPipeline', pluginName })

  return (
    <div className="flex items-center justify-between gap-x-2">
      <div className="flex items-center gap-x-1 overflow-hidden">
        <CredentialSelector {...rest} />
        <Separator decorative orientation="vertical" className="mx-1 h-3.5" />
        <Tooltip>
          <TooltipTrigger
            render={
              <IconButton
                variant="ghost"
                size="md"
                className="shrink-0"
                aria-label={configurationTip}
                onClick={onClickConfiguration}
              >
                <span aria-hidden className="i-ri-equalizer-2-line size-4" />
              </IconButton>
            }
          />
          <TooltipContent>{configurationTip}</TooltipContent>
        </Tooltip>
      </div>
      <a
        className="flex shrink-0 items-center gap-x-1 system-xs-medium text-text-accent"
        href={docLink}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span aria-hidden className="i-ri-book-open-line size-3.5 shrink-0" />
        <span title={docTitle}>{docTitle}</span>
      </a>
    </div>
  )
}

export default React.memo(Header)
