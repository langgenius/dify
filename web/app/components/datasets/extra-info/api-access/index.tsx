import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiAggregate } from '@/app/components/base/icons/src/vender/knowledge'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/base/ui/popover'
import Indicator from '@/app/components/header/indicator'
import Card from './card'

type ApiAccessProps = {
  expand: boolean
  apiEnabled: boolean
}

const ApiAccess = ({
  expand,
  apiEnabled,
}: ApiAccessProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="p-3 pt-2">
      <Popover
        open={open}
        onOpenChange={setOpen}
      >
        <PopoverTrigger
          render={(
            <button type="button" className="w-full border-none bg-transparent p-0 text-left">
              <div className={cn(
                'relative flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-components-panel-border px-3',
                !expand && 'w-8 justify-center',
                open ? 'bg-state-base-hover' : 'hover:bg-state-base-hover',
              )}
              >
                <ApiAggregate className="size-4 shrink-0 text-text-secondary" />
                {expand && <div className="grow system-sm-medium text-text-secondary">{t('appMenus.apiAccess', { ns: 'common' })}</div>}
                <Indicator
                  className={cn('shrink-0', !expand && 'absolute -top-px -right-px')}
                  color={apiEnabled ? 'green' : 'yellow'}
                />
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
            apiEnabled={apiEnabled}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default React.memo(ApiAccess)
