import type { FormInputItem, FormInputItemPlaceholder } from '@/app/components/workflow/nodes/human-input/types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { InputVarType } from '@/app/components/workflow/types'
import { getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'
// import PromptEditor from '@/app/components/base/prompt-editor'
// import TagLabel from './tag-label'
import Button from '../../../button'
import PrePopulate from './pre-populate'

const i18nPrefix = 'nodes.humanInput.insertInputField'

type Props = {
  nodeId: string
  isEdit: boolean
  payload?: FormInputItem
  onChange: (newPayload: FormInputItem) => void
  onCancel: () => void
}
const defaultPayload: FormInputItem = {
  type: InputVarType.paragraph,
  output_variable_name: '',
  placeholder: { type: 'constant', selector: [], value: '' },
}
const InputField: React.FC<Props> = ({
  nodeId,
  isEdit,
  payload,
  onChange,
  onCancel,
}) => {
  const { t } = useTranslation()
  const [tempPayload, setTempPayload] = useState(payload || defaultPayload)
  const handleSave = useCallback(() => {
    onChange(tempPayload)
  }, [tempPayload])
  const placeholderConfig = tempPayload.placeholder
  const handlePlaceholderChange = useCallback((key: keyof FormInputItemPlaceholder) => {
    return (value: any) => {
      const nextValue = produce(tempPayload, (draft) => {
        if (!draft.placeholder)
          draft.placeholder = { type: 'constant', selector: [], value: '' }
        draft.placeholder[key] = value
        if (key === 'selector')
          draft.placeholder.type = 'variable'
        else if (key === 'value')
          draft.placeholder.type = 'constant'
      })
      setTempPayload(nextValue)
    }
  }, [tempPayload])
  return (
    <div className="w-[372px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-3 shadow-lg backdrop-blur-[5px]">
      <div className="system-md-semibold text-text-primary">{t(`${i18nPrefix}.title`, { ns: 'workflow' })}</div>
      <div className="mt-3">
        <div className="system-xs-medium text-text-secondary">
          {t(`${i18nPrefix}.saveResponseAs`, { ns: 'workflow' })}
          <span className="system-xs-regular relative text-text-destructive-secondary">*</span>
        </div>
        <Input
          className="mt-1.5"
          placeholder={t(`${i18nPrefix}.saveResponseAsPlaceholder`, { ns: 'workflow' })}
          value={tempPayload.output_variable_name}
          onChange={(e) => {
            setTempPayload(prev => ({ ...prev, output_variable_name: e.target.value }))
          }}
          autoFocus
        />
      </div>
      <div className="mt-4">
        <div className="system-xs-medium mb-1.5 text-text-secondary">
          {t(`${i18nPrefix}.prePopulateField`, { ns: 'workflow' })}
        </div>
        <PrePopulate
          isVariable={placeholderConfig?.type === 'variable'}
          onIsVariableChange={(isVariable) => {
            handlePlaceholderChange('type')(isVariable ? 'variable' : 'constant')
          }}
          nodeId={nodeId}
          valueSelector={placeholderConfig?.selector}
          onValueSelectorChange={handlePlaceholderChange('selector')}
          value={placeholderConfig?.value}
          onValueChange={handlePlaceholderChange('value')}
        />
      </div>
      <div className="mt-4 flex justify-end space-x-2">
        <Button onClick={onCancel}>{t('operation.cancel', { ns: 'common' })}</Button>
        {isEdit
          ? (
              <Button
                variant="primary"
                onClick={handleSave}
              >
                {t('operation.save', { ns: 'common' })}
              </Button>
            )
          : (
              <Button
                className="flex"
                variant="primary"
                onClick={handleSave}
              >
                <span className="mr-1">{t(`${i18nPrefix}.insert`, { ns: 'workflow' })}</span>
                <span className="system-kbd mr-0.5 flex h-4 items-center rounded-[4px] bg-components-kbd-bg-white px-1">{getKeyboardKeyNameBySystem('ctrl')}</span>
                <span className=" system-kbd flex h-4 items-center rounded-[4px] bg-components-kbd-bg-white px-1">↩︎</span>
              </Button>
            )}

      </div>
    </div>
  )
}

export default InputField
