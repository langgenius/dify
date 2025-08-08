import React, { useCallback, useState } from 'react'
import Input from '@/app/components/base/input'
// import PromptEditor from '@/app/components/base/prompt-editor'
// import TagLabel from './tag-label'
import Button from '../../../button'
import { useTranslation } from 'react-i18next'
import { getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'

const i18nPrefix = 'workflow.nodes.humanInput.insertInputField'

type Props = {
  isEdit: boolean
  payload: FormInputItem
  onChange: (newPayload: FormInputItem) => void
  onCancel: () => void
}
const InputField: React.FC<Props> = ({
  isEdit,
  payload,
  onChange,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [tempPayload, setTempPayload] = useState(payload)
  const handleSave = useCallback(() => {
    onChange(tempPayload)
  }, [tempPayload])
  return (
    <div className="w-[372px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-3 shadow-lg backdrop-blur-[5px]">
      <div className='system-md-semibold text-text-primary'>{t(`${i18nPrefix}.title`)}</div>
      <div className="mt-3">
        <div className='system-xs-medium text-text-secondary'>
          {t(`${i18nPrefix}.saveResponseAs`)}<span className='system-xs-regular relative text-text-destructive-secondary'>*</span>
        </div>
        <Input
          className="mt-1.5"
          placeholder={t(`${i18nPrefix}.saveResponseAsPlaceholder`)}
          value={tempPayload.output_variable_name}
          onChange={(e) => {
            setTempPayload(prev => ({ ...prev, output_variable_name: e.target.value }))
          }}
        />
      </div>
      <div className='mt-4'>
        <div className='system-xs-medium text-text-secondary'>
          {t(`${i18nPrefix}.prePopulateField`)}
        </div>
        {/* <PromptEditor
          className='mt-1.5 h-[72px] rounded-lg bg-components-input-bg-normal px-3 py-1'
          placeholder={
          <div className='system-sm-regular mt-1 px-3 text-text-tertiary'>
            <div className="flex h-5 items-center space-x-1">
              <span>{t(`${i18nPrefix}.add`)}</span>
              <TagLabel type='edit' text={t(`${i18nPrefix}.staticContent`)} />
              <span>{t(`${i18nPrefix}.or`)}</span>
              <TagLabel type='variable' text={t(`${i18nPrefix}.variable`)} />
              <span>{t(`${i18nPrefix}.users`)}</span>
            </div>
            <div className="flex h-5 items-center">{t(`${i18nPrefix}.prePopulateFieldPlaceholderEnd`)}</div>
          </div>
          }
          onChange={
            (newValue) => {
              setTempPayload(prev => ({ ...prev, prePopulateField: newValue }))
            }
          }
        /> */}
        <Input
          className='mt-1.5'
          value={tempPayload.placeholder?.value}
          onChange={(e) => {
            setTempPayload(prev => ({ ...prev, placeholder: { ...(prev.placeholder || {}), value: e.target.value } } as any))
          }}
        />
      </div>
      <div className='mt-4 flex justify-end space-x-2'>
        <Button onClick={onCancel}>{t('common.operation.cancel')}</Button>
        {isEdit ? (
          <Button
            variant='primary'
            onClick={handleSave}
          >
            {t('common.operation.save')}
          </Button>
        ) : (
          <Button
            className='flex'
            variant='primary'
            onClick={handleSave}
          >
            <span className='mr-1'>{t(`${i18nPrefix}.insert`)}</span>
            <span className='system-kbd mr-0.5 flex h-4 items-center rounded-[4px] bg-components-kbd-bg-white px-1'>{getKeyboardKeyNameBySystem('ctrl')}</span>
            <span className=' system-kbd flex h-4 items-center rounded-[4px] bg-components-kbd-bg-white px-1'>↩︎</span>
          </Button>
        )}

      </div>
    </div>
  )
}

export default InputField
