import { RiBookOpenLine, RiKey2Line } from '@remixicon/react'
import Link from 'next/link'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import CopyFeedback from '@/app/components/base/copy-feedback'
import { ApiAggregate } from '@/app/components/base/icons/src/vender/knowledge'
import SecretKeyModal from '@/app/components/develop/secret-key/secret-key-modal'
import Indicator from '@/app/components/header/indicator'
import { useDatasetApiAccessUrl } from '@/hooks/use-api-access-url'

type CardProps = {
  apiBaseUrl: string
}

const Card = ({
  apiBaseUrl,
}: CardProps) => {
  const { t } = useTranslation()
  const [isSecretKeyModalVisible, setIsSecretKeyModalVisible] = useState(false)

  const apiReferenceUrl = useDatasetApiAccessUrl()

  const handleOpenSecretKeyModal = useCallback(() => {
    setIsSecretKeyModalVisible(true)
  }, [])

  const handleCloseSecretKeyModal = useCallback(() => {
    setIsSecretKeyModalVisible(false)
  }, [])

  return (
    <div className="flex w-[360px] flex-col rounded-xl border border-components-panel-border bg-components-panel-bg shadow-lg shadow-shadow-shadow-1">
      <div className="flex flex-col gap-y-3 p-4">
        <div className="flex items-center gap-x-3">
          <div className="flex grow items-center gap-x-2">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-brand-blue-brand-500 shadow-md shadow-shadow-shadow-5">
              <ApiAggregate className="size-4 text-text-primary-on-surface" />
            </div>
            <div className="system-sm-semibold grow truncate text-text-secondary">
              {t('serviceApi.card.title', { ns: 'dataset' })}
            </div>
          </div>
          <div className="flex items-center gap-x-1">
            <Indicator
              className="shrink-0"
              color={
                apiBaseUrl ? 'green' : 'yellow'
              }
            />
            <div
              className="system-xs-semibold-uppercase text-text-success"
            >
              {t('serviceApi.enabled', { ns: 'dataset' })}
            </div>
          </div>
        </div>
        <div className="flex flex-col">
          <div className="system-xs-regular leading-6 text-text-tertiary">
            {t('serviceApi.card.endpoint', { ns: 'dataset' })}
          </div>
          <div className="flex h-8 items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 pl-2">
            <div className="flex h-4 min-w-0 flex-1 items-start justify-start gap-2 px-1">
              <div className="system-xs-medium truncate text-text-secondary">
                {apiBaseUrl}
              </div>
            </div>
            <CopyFeedback
              content={apiBaseUrl}
            />
          </div>
        </div>
      </div>
      {/* Actions */}
      <div className="flex gap-x-1 border-t-[0.5px] border-divider-subtle p-4">
        <Button
          variant="ghost"
          size="small"
          className="gap-x-px text-text-tertiary"
          onClick={handleOpenSecretKeyModal}
        >
          <RiKey2Line className="size-3.5 shrink-0" />
          <span className="system-xs-medium px-[3px]">
            {t('serviceApi.card.apiKey', { ns: 'dataset' })}
          </span>
        </Button>
        <Link
          href={apiReferenceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button
            variant="ghost"
            size="small"
            className="gap-x-px text-text-tertiary"
          >
            <RiBookOpenLine className="size-3.5 shrink-0" />
            <span className="system-xs-medium px-[3px]">
              {t('serviceApi.card.apiReference', { ns: 'dataset' })}
            </span>
          </Button>
        </Link>
      </div>
      <SecretKeyModal
        isShow={isSecretKeyModalVisible}
        onClose={handleCloseSecretKeyModal}
      />
    </div>
  )
}

export default React.memo(Card)
