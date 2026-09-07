import type { DefaultValueForm } from './types'
import { Input } from '@langgenius/dify-ui/input'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { VarType } from '@/app/components/workflow/types'

type DefaultValueProps = {
  forms: DefaultValueForm[]
  onFormChange: (form: DefaultValueForm) => void
}
const DefaultValue = ({ forms, onFormChange }: DefaultValueProps) => {
  const { t } = useTranslation()
  const id = useId()

  return (
    <div className="px-4 pt-2">
      <div className="mb-2 body-xs-regular text-text-tertiary">
        {t(($) => $['nodes.common.errorHandle.defaultValue.desc'], { ns: 'workflow' })}
        &nbsp;
      </div>
      <div className="space-y-1">
        {forms.map((form, index) => {
          const isInput = form.type === VarType.string || form.type === VarType.number
          const inputId = `${id}-${index}`
          return (
            <div key={index} className="py-1">
              <div className="mb-1 flex items-center">
                {isInput ? (
                  <label htmlFor={inputId} className="mr-1 system-sm-medium text-text-primary">
                    {form.key}
                  </label>
                ) : (
                  <div className="mr-1 system-sm-medium text-text-primary">{form.key}</div>
                )}
                <div className="system-xs-regular text-text-tertiary">{form.type}</div>
              </div>
              {isInput && (
                <Input
                  id={inputId}
                  type={form.type === VarType.number ? 'number' : 'text'}
                  placeholder={t(($) => $['placeholder.input'], { ns: 'common' })}
                  value={form.value || (form.type === VarType.string ? '' : 0)}
                  onValueChange={(value) => onFormChange({ key: form.key, type: form.type, value })}
                />
              )}
              {(form.type === VarType.array ||
                form.type === VarType.arrayNumber ||
                form.type === VarType.arrayString ||
                form.type === VarType.arrayObject ||
                form.type === VarType.object) && (
                <CodeEditor
                  language={CodeLanguage.json}
                  value={form.value}
                  onChange={(value) => onFormChange({ key: form.key, type: form.type, value })}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default DefaultValue
