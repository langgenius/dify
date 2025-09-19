import React from 'react'
import Divider from '@/app/components/base/divider'
import Button from '@/app/components/base/button'
import { RiBookOpenLine, RiEqualizer2Line } from '@remixicon/react'
import type { CredentialSelectorProps } from './credential-selector'
import CredentialSelector from './credential-selector'
import Tooltip from '@/app/components/base/tooltip'
import { useTranslation } from 'react-i18next'

type HeaderProps = {
  docTitle: string
  docLink: string
  onClickConfiguration?: () => void
} & CredentialSelectorProps

const Header = ({
  docTitle,
  docLink,
  onClickConfiguration,
  ...rest
}: HeaderProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center justify-between gap-x-2'>
      <div className='flex items-center gap-x-1 overflow-hidden'>
        <CredentialSelector
          {...rest}
        />
        <Divider type='vertical' className='mx-1 h-3.5 shrink-0' />
        <Tooltip
          popupContent={t('datasetPipeline.configurationTip', { pluginName: rest.pluginName })}
          position='top'
        >
          <Button
            variant='ghost'
            size='small'
            className='size-6 shrink-0 px-1'
          >
            <RiEqualizer2Line
              className='h-4 w-4'
              onClick={onClickConfiguration}
            />
          </Button>
        </Tooltip>
      </div>
      <a
        className='system-xs-medium flex shrink-0 items-center gap-x-1 text-text-accent'
        href={docLink}
        target='_blank'
        rel='noopener noreferrer'
      >
        <RiBookOpenLine className='size-3.5 shrink-0' />
        <span title={docTitle}>{docTitle}</span>
      </a>
    </div>
  )
}

export default React.memo(Header)
