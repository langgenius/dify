import type { CredentialSelectorProps } from './credential-selector'
import { Button } from '@langgenius/dify-ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
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
  const configurationTip = t('configurationTip', { ns: 'datasetPipeline', pluginName })

  return (
    <div className="flex items-center justify-between gap-x-2">
      <div className="flex items-center gap-x-1 overflow-hidden">
        <CredentialSelector
          {...rest}
        />
        <Divider type="vertical" className="mx-1 h-3.5 shrink-0" />
        <Tooltip>
          <TooltipTrigger
            render={(
              <Button
                variant="ghost"
                size="small"
                className="size-6 shrink-0 px-1"
                aria-label={configurationTip}
                onClick={onClickConfiguration}
              >
                <span aria-hidden className="i-ri-equalizer-2-line h-4 w-4" />
              </Button>
            )}
          />
          <TooltipContent>
            {configurationTip}
          </TooltipContent>
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
