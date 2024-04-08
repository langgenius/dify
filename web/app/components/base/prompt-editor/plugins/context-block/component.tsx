import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelectOrDelete, useTrigger } from '../../hooks'
import { UPDATE_DATASETS_EVENT_EMITTER } from '../../constants'
import type { Dataset } from './index'
import { DELETE_CONTEXT_BLOCK_COMMAND } from './index'
import { File05, Folder } from '@/app/components/base/icons/src/vender/solid/files'
import { Plus } from '@/app/components/base/icons/src/vender/line/general'
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
      group inline-flex items-center pl-1 pr-0.5 h-6 border border-transparent bg-[#F4F3FF] text-[#6938EF] rounded-[5px] hover:bg-[#EBE9FE]
      ${open ? 'bg-[#EBE9FE]' : 'bg-[#F4F3FF]'}
      ${isSelected && '!border-[#9B8AFB]'}
    `} ref={ref}>
      <File05 className='mr-1 w-[14px] h-[14px]' />
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
            flex items-center justify-center w-[18px] h-[18px] text-[11px] font-semibold rounded cursor-pointer
            ${open ? 'bg-[#6938EF] text-white' : 'bg-white/50 group-hover:bg-white group-hover:shadow-xs'}
          `}>{localDatasets.length}</div>
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent style={{ zIndex: 100 }}>
            <div className='w-[360px] bg-white rounded-xl shadow-lg'>
              <div className='p-4'>
                <div className='mb-2 text-xs font-medium text-gray-500'>
                  {t('common.promptEditor.context.modal.title', { num: localDatasets.length })}
                </div>
                <div className='max-h-[270px] overflow-y-auto'>
                  {
                    localDatasets.map(dataset => (
                      <div key={dataset.id} className='flex items-center h-8'>
                        <div className='flex items-center justify-center shrink-0 mr-2 w-6 h-6 bg-[#F5F8FF] rounded-md border-[0.5px] border-[#EAECF5]'>
                          <Folder className='w-4 h-4 text-[#444CE7]' />
                        </div>
                        <div className='text-sm text-gray-800 truncate' title=''>{dataset.name}</div>
                      </div>
                    ))
                  }
                </div>
                <div className='flex items-center h-8 text-[#155EEF] cursor-pointer' onClick={onAddContext}>
                  <div className='shrink-0 flex justify-center items-center mr-2 w-6 h-6 rounded-md border-[0.5px] border-gray-100'>
                    <Plus className='w-[14px] h-[14px]' />
                  </div>
                  <div className='text-[13px] font-medium' title=''>{t('common.promptEditor.context.modal.add')}</div>
                </div>
              </div>
              <div className='px-4 py-3 text-xs text-gray-500 bg-gray-50 border-t-[0.5px] border-gray-50 rounded-b-xl'>
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
