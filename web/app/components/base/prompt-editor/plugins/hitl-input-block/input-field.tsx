import React from 'react'
import Input from '@/app/components/base/input'
import PromptEditor from '@/app/components/base/prompt-editor'
import TagLabel from './tag-label'
import Button from '../../../button'
import { useTranslation } from 'react-i18next'
import { getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'

const InputField: React.FC = () => {
  const { t } = useTranslation()
  return (
    <div className="w-[372px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-3 shadow-lg backdrop-blur-[5px]">
      <div className='system-md-semibold text-text-primary'>Insert input field</div>
      <div className="mt-3">
        <div className='system-xs-medium text-text-secondary'>
          Save response as<span className='system-xs-regular relative text-text-destructive-secondary'>*</span>
        </div>
        <Input
          className="mt-1.5"
          placeholder="Name this variable for later reference"
        />
      </div>
      <div className='mt-4'>
        <div className='system-xs-medium text-text-secondary'>
          Pre-populate field
        </div>
        <PromptEditor
          className='mt-1.5 h-[72px] rounded-lg bg-components-input-bg-normal px-3 py-1'
          placeholder={
          <div className='system-sm-regular mt-1 px-3 text-text-tertiary'>
            <div className="flex h-5 items-center space-x-1">
              <span>Add</span>
              <TagLabel type='edit' text='static content' />
              <span>or</span>
              <TagLabel type='variable' text='variable' />
              <span>users</span>
            </div>
            <div className="flex h-5 items-center">will see initially, or leave empty.</div>
          </div>}
        />
      </div>
      <div className='mt-4 flex justify-end space-x-2'>
        <Button >{t('common.operation.cancel')}</Button>
        <Button
          className='flex'
          variant='primary'
        >
          <span className='mr-1'>Insert</span>
          <span className='system-kbd mr-0.5 flex h-4 items-center rounded-[4px] bg-components-kbd-bg-white px-1'>{getKeyboardKeyNameBySystem('ctrl')}</span>
          <span className=' system-kbd flex items-center rounded-[4px] bg-components-kbd-bg-white px-1'>↩︎</span>
        </Button>
      </div>
    </div>
  )
}

export default InputField
