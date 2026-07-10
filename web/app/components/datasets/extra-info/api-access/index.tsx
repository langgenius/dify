import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiAggregate } from '@/app/components/base/icons/src/vender/knowledge'
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
    <div className={cn(expand ? 'px-1 py-2' : 'flex justify-center px-3 py-2')}>
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
                {expand && <div className="min-w-0 grow truncate system-sm-regular text-text-secondary">{t($ => $['appMenus.apiAccess'], { ns: 'common' })}</div>}
                <StatusDot
                  className={cn('shrink-0', !expand && 'absolute -top-px -right-px')}
                  status={apiEnabled ? 'success' : 'warning'}
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
