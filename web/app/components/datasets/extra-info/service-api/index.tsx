import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SecretKeyModal from '@/app/components/develop/secret-key/secret-key-modal'
import Card from './card'

type ServiceApiProps = {
  apiBaseUrl: string
}

const ServiceApi = ({
  apiBaseUrl,
}: ServiceApiProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [isSecretKeyModalVisible, setIsSecretKeyModalVisible] = useState(false)

  const handleOpenSecretKeyModal = useCallback(() => {
    setIsSecretKeyModalVisible(true)
  }, [])

  const handleCloseSecretKeyModal = useCallback(() => {
    setIsSecretKeyModalVisible(false)
  }, [])

  return (
    <div>
      <Popover
        open={open}
        onOpenChange={setOpen}
      >
        <PopoverTrigger
          render={(
            <button type="button" className="w-full border-none bg-transparent p-0 text-left">
              <div className={cn(
                'relative flex h-6 cursor-pointer items-center justify-center gap-1 overflow-hidden rounded-md px-1.5 py-1 text-text-tertiary',
                open ? 'bg-state-base-hover' : 'hover:bg-state-base-hover',
              )}
              >
                <StatusDot
                  className={cn('shrink-0')}
                  status={
                    apiBaseUrl ? 'success' : 'warning'
                  }
                />
                <div className="px-0.5 system-xs-medium">{t('serviceApi.title', { ns: 'dataset' })}</div>
              </div>
            </button>
          )}
        />
        <PopoverContent
          placement="top-start"
          sideOffset={4}
          alignOffset={-4}
          popupClassName="border-none bg-transparent shadow-none"
        >
          <Card
            apiBaseUrl={apiBaseUrl}
            onOpenSecretKeyModal={handleOpenSecretKeyModal}
          />
        </PopoverContent>
      </Popover>
      <SecretKeyModal
        isShow={isSecretKeyModalVisible}
        onClose={handleCloseSecretKeyModal}
      />
    </div>
  )
}

export default React.memo(ServiceApi)
