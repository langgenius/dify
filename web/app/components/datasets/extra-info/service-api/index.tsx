import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/base/ui/popover'
import Indicator from '@/app/components/header/indicator'
import Card from './card'

type ServiceApiProps = {
  apiBaseUrl: string
}

const ServiceApi = ({
  apiBaseUrl,
}: ServiceApiProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

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
                'relative flex h-8 cursor-pointer items-center gap-2 rounded-lg border-[0.5px] border-components-button-secondary-border-hover bg-components-button-secondary-bg px-3',
                open ? 'bg-components-button-secondary-bg-hover' : 'hover:bg-components-button-secondary-bg-hover',
              )}
              >
                <Indicator
                  className={cn('shrink-0')}
                  color={
                    apiBaseUrl ? 'green' : 'yellow'
                  }
                />
                <div className="grow system-sm-medium text-text-secondary">{t('serviceApi.title', { ns: 'dataset' })}</div>
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
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default React.memo(ServiceApi)
