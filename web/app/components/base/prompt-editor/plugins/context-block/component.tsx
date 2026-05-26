import type { FC } from 'react'
import type { Dataset } from './index'
import type { EventEmitterValue } from '@/context/event-emitter'

import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { UPDATE_DATASETS_EVENT_EMITTER } from '../../constants'
import { useSelectOrDelete, useTrigger } from '../../hooks'
import { DELETE_CONTEXT_BLOCK_COMMAND } from './index'

type ContextBlockComponentProps = {
  nodeKey: string
  datasets?: Dataset[]
  onAddContext: () => void
  canNotAddContext?: boolean
}

const ContextBlockComponent: FC<ContextBlockComponentProps> = ({
  nodeKey,
  datasets = [],
  onAddContext,
  canNotAddContext,
}) => {
  const { t } = useTranslation()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_CONTEXT_BLOCK_COMMAND)
  const [triggerRef, open, setOpen] = useTrigger<HTMLButtonElement>()
  const { eventEmitter } = useEventEmitterContextContext()
  const [localDatasets, setLocalDatasets] = useState<Dataset[]>(datasets)

  eventEmitter?.useSubscription((event?: EventEmitterValue) => {
    if (typeof event === 'string')
      return

    if (event?.type === UPDATE_DATASETS_EVENT_EMITTER && Array.isArray(event.payload))
      setLocalDatasets(event.payload as Dataset[])
  })

  return (
    <div
      className={`
      group inline-flex h-6 items-center rounded-[5px] border border-transparent bg-[#F4F3FF] pr-0.5 pl-1 text-[#6938EF] hover:bg-[#EBE9FE]
      ${open ? 'bg-[#EBE9FE]' : ''}
      ${isSelected && 'border-[#9B8AFB]!'}
    `}
      ref={ref}
    >
      <span className="mr-1 i-custom-vender-solid-files-file-05 h-[14px] w-[14px]" data-testid="file-icon" />
      <div className="mr-1 text-xs font-medium">{t('promptEditor.context.item.title', { ns: 'common' })}</div>
      {!canNotAddContext && (
        <Popover
          open={open}
          onOpenChange={setOpen}
        >
          <PopoverTrigger
            render={(
              <button
                type="button"
                aria-label={t('promptEditor.context.item.title', { ns: 'common' })}
                className={`
            flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded border-none p-0 text-[11px] font-semibold
            ${open ? 'bg-[#6938EF] text-white' : 'bg-white/50 group-hover:bg-white group-hover:shadow-xs'}
          `}
                ref={triggerRef}
                onClick={e => e.preventDefault()}
              >
                {localDatasets.length}
              </button>
            )}
          />
          <PopoverContent
            placement="bottom-end"
            sideOffset={3}
            alignOffset={-147}
            popupClassName="border-none bg-transparent shadow-none"
          >
            <div className="w-[360px] rounded-xl bg-white shadow-lg">
              <div className="p-4">
                <div className="mb-2 text-xs font-medium text-gray-500">
                  {t('promptEditor.context.modal.title', { ns: 'common', num: localDatasets.length })}
                </div>
                <div className="max-h-[270px] overflow-y-auto">
                  {
                    localDatasets.map(dataset => (
                      <div key={dataset.id} className="flex h-8 items-center">
                        <div className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-[#EAECF5] bg-[#F5F8FF]">
                          <span className="i-custom-vender-solid-files-folder h-4 w-4 text-[#444CE7]" data-testid="folder-icon" />
                        </div>
                        <div className="truncate text-sm text-gray-800" title="">{dataset.name}</div>
                      </div>
                    ))
                  }
                </div>
                <button
                  type="button"
                  className="flex h-8 cursor-pointer items-center border-none bg-transparent p-0 text-left text-[#155EEF] focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                  onClick={onAddContext}
                >
                  <div className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-gray-100">
                    <span className="i-ri-add-line h-[14px] w-[14px]" aria-hidden="true" />
                  </div>
                  <div className="text-[13px] font-medium" title="">{t('promptEditor.context.modal.add', { ns: 'common' })}</div>
                </button>
              </div>
              <div className="rounded-b-xl border-t-[0.5px] border-gray-50 bg-gray-50 px-4 py-3 text-xs text-gray-500">
                {t('promptEditor.context.modal.footer', { ns: 'common' })}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}

    </div>
  )
}

export default ContextBlockComponent
