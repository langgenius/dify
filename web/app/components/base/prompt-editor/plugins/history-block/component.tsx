import type { FC } from 'react'
import type { RoleName } from './index'
import type { EventEmitterValue } from '@/context/event-emitter'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import {
  RiMoreFill,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageClockCircle } from '@/app/components/base/icons/src/vender/solid/general'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { UPDATE_HISTORY_EVENT_EMITTER } from '../../constants'
import { useSelectOrDelete, useTrigger } from '../../hooks'
import { DELETE_HISTORY_BLOCK_COMMAND } from './index'

type HistoryBlockComponentProps = {
  nodeKey: string
  roleName?: RoleName
  onEditRole: () => void
}

const HistoryBlockComponent: FC<HistoryBlockComponentProps> = ({
  nodeKey,
  roleName = { user: '', assistant: '' },
  onEditRole,
}) => {
  const { t } = useTranslation()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_HISTORY_BLOCK_COMMAND)
  const [triggerRef, open, setOpen] = useTrigger()
  const { eventEmitter } = useEventEmitterContextContext()
  const [localRoleName, setLocalRoleName] = useState<RoleName>(roleName)

  eventEmitter?.useSubscription((event?: EventEmitterValue) => {
    if (typeof event === 'string')
      return

    if (event?.type === UPDATE_HISTORY_EVENT_EMITTER && event.payload && typeof event.payload === 'object')
      setLocalRoleName(event.payload as RoleName)
  })

  return (
    <div
      className={`
      group inline-flex h-6 items-center rounded-[5px] border border-transparent pr-0.5 pl-1 text-[#DD2590] hover:bg-[#FCE7F6]
      ${open ? 'bg-[#FCE7F6]' : 'bg-[#FDF2FA]'}
      ${isSelected && 'border-[#F670C7]!'}
    `}
      ref={ref}
    >
      <MessageClockCircle className="mr-1 h-[14px] w-[14px]" />
      <div className="mr-1 text-xs font-medium">{t('promptEditor.history.item.title', { ns: 'common' })}</div>
      <Popover
        open={open}
        onOpenChange={setOpen}
      >
        <PopoverTrigger
          nativeButton={false}
          render={(
            <div
              className={`
            flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded
            ${open ? 'bg-[#DD2590] text-white' : 'bg-white/50 group-hover:bg-white group-hover:shadow-xs'}
          `}
              ref={triggerRef}
              onClick={e => e.preventDefault()}
            >
              <RiMoreFill className="h-3 w-3" />
            </div>
          )}
        />
        <PopoverContent
          placement="top-end"
          sideOffset={4}
          alignOffset={-148}
          popupClassName="border-none bg-transparent shadow-none"
        >
          <div className="w-[360px] rounded-xl bg-white shadow-lg">
            <div className="p-4">
              <div className="mb-2 text-xs font-medium text-gray-500">{t('promptEditor.history.modal.title', { ns: 'common' })}</div>
              <div className="flex items-center text-sm text-gray-700">
                <div className="mr-1 w-20 text-xs font-semibold">{localRoleName?.user}</div>
                {t('promptEditor.history.modal.user', { ns: 'common' })}
              </div>
              <div className="flex items-center text-sm text-gray-700">
                <div className="mr-1 w-20 text-xs font-semibold">{localRoleName?.assistant}</div>
                {t('promptEditor.history.modal.assistant', { ns: 'common' })}
              </div>
            </div>
            <div
              className="cursor-pointer rounded-b-xl border-t border-black/5 px-4 py-3 text-xs text-[#155EEF]"
              onClick={onEditRole}
            >
              {t('promptEditor.history.modal.edit', { ns: 'common' })}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default HistoryBlockComponent
