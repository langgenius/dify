import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
} from '@remixicon/react'
import { useSelectOrDelete, useTrigger } from '../../hooks'
import { UPDATE_DATASETS_EVENT_EMITTER } from '../../constants'
import type { Dataset } from './index'
import { DELETE_CONTEXT_BLOCK_COMMAND } from './index'
import { File05, Folder } from '@/app/components/base/icons/src/vender/solid/files'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useEventEmitterContextContext } from '@/context/event-emitter'

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
  const [triggerRef, open, setOpen] = useTrigger()
  const { eventEmitter } = useEventEmitterContextContext()
  const [localDatasets, setLocalDatasets] = useState<Dataset[]>(datasets)

  eventEmitter?.useSubscription((v: any) => {
    if (v?.type === UPDATE_DATASETS_EVENT_EMITTER)
      setLocalDatasets(v.payload)
  })

  return (
    <div className={`
      group inline-flex h-6 items-center rounded-[5px] border border-transparent bg-[#F4F3FF] pl-1 pr-0.5 text-[#6938EF] hover:bg-[#EBE9FE]
      ${open ? 'bg-[#EBE9FE]' : 'bg-[#F4F3FF]'}
      ${isSelected && '!border-[#9B8AFB]'}
    `} ref={ref}>
      <File05 className='mr-1 h-[14px] w-[14px]' />
      <div className='mr-1 text-xs font-medium'>{t('common.promptEditor.context.item.title')}</div>
      {!canNotAddContext && (
        <PortalToFollowElem
          open={open}
          onOpenChange={setOpen}
          placement='bottom-end'
          offset={{
            mainAxis: 3,
            alignmentAxis: -147,
          }}
        >
          <PortalToFollowElemTrigger ref={triggerRef}>
            <div className={`
            flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded text-[11px] font-semibold
            ${open ? 'bg-[#6938EF] text-white' : 'bg-white/50 group-hover:bg-white group-hover:shadow-xs'}
          `}>{localDatasets.length}</div>
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent style={{ zIndex: 100 }}>
            <div className='w-[360px] rounded-xl bg-white shadow-lg'>
              <div className='p-4'>
                <div className='mb-2 text-xs font-medium text-gray-500'>
                  {t('common.promptEditor.context.modal.title', { num: localDatasets.length })}
                </div>
                <div className='max-h-[270px] overflow-y-auto'>
                  {
                    localDatasets.map(dataset => (
                      <div key={dataset.id} className='flex h-8 items-center'>
                        <div className='mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-[#EAECF5] bg-[#F5F8FF]'>
                          <Folder className='h-4 w-4 text-[#444CE7]' />
                        </div>
                        <div className='truncate text-sm text-gray-800' title=''>{dataset.name}</div>
                      </div>
                    ))
                  }
                </div>
                <div className='flex h-8 cursor-pointer items-center text-[#155EEF]' onClick={onAddContext}>
                  <div className='mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-[0.5px] border-gray-100'>
                    <RiAddLine className='h-[14px] w-[14px]' />
                  </div>
                  <div className='text-[13px] font-medium' title=''>{t('common.promptEditor.context.modal.add')}</div>
                </div>
              </div>
              <div className='rounded-b-xl border-t-[0.5px] border-gray-50 bg-gray-50 px-4 py-3 text-xs text-gray-500'>
                {t('common.promptEditor.context.modal.footer')}
              </div>
            </div>
          </PortalToFollowElemContent>
        </PortalToFollowElem>
      )}

    </div>
  )
}

export default ContextBlockComponent
