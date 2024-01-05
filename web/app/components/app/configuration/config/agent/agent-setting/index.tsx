'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import PromptEditor from '../prompt-editor'
import Button from '@/app/components/base/button'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'

type Props = {
  payload: any
  onCancel: () => void
  onSave: (payload: any) => void
}

const AgentSetting: FC<Props> = ({
  payload,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation()

  const handleSave = () => {
    onSave(payload)
  }

  return (
    <div className='fixed z-[100] inset-0 overflow-hidden flex justify-end p-2'
      style={{
        backgroundColor: 'rgba(16, 24, 40, 0.20)',
      }}
    >
      <div
        className='w-[640px] flex flex-col h-full overflow-hidden bg-white border-[0.5px] border-gray-200 rounded-xl shadow-xl'
      >
        <div className='shrink-0 flex justify-between items-center pl-6 pr-5 h-14 border-b border-b-gray-100'>
          <div className='flex flex-col text-base font-semibold text-gray-900'>
            <div className='leading-6'>{t('appDebug.agent.setting.name')}</div>
          </div>
          <div className='flex items-center'>
            <div
              onClick={onCancel}
              className='flex justify-center items-center w-6 h-6 cursor-pointer'
            >
              <XClose className='w-4 h-4 text-gray-500' />
            </div>
          </div>
        </div>
        {/* Body */}
        <div className='grow p-6 pt-5 border-b overflow-y-auto pb-[68px]' style={{
          borderBottom: 'rgba(0, 0, 0, 0.05)',
        }}>
          <div>
            Agent Mode
          </div>

          <div className='mb-2 leading-[18px] text-xs font-semibold text-gray-500 uppercase'>
            {t('appDebug.agent.buildInPrompt')}
          </div>
          <PromptEditor
            className='mb-2'
            type='first-prompt'
            value='aaa'
            onChange={() => { }}
          />

          <PromptEditor
            className='mb-2'
            type='next-iteration'
            value='bbb'
            onChange={() => { }}
          />
        </div>
        <div
          className='sticky z-[5] bottom-0 w-full flex justify-end py-4 px-6 border-t bg-white '
          style={{
            borderColor: 'rgba(0, 0, 0, 0.05)',
          }}
        >
          <Button
            onClick={onCancel}
            className='mr-2 text-sm font-medium'
          >
            {t('common.operation.cancel')}
          </Button>
          <Button
            type='primary'
            className='text-sm font-medium'
            onClick={handleSave}
          >
            {t('common.operation.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
export default React.memo(AgentSetting)
