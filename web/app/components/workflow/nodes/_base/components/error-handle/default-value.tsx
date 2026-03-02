import type { DefaultValueForm } from './types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { VarType } from '@/app/components/workflow/types'

type DefaultValueProps = {
  forms: DefaultValueForm[]
  onFormChange: (form: DefaultValueForm) => void
}
const DefaultValue = ({
  forms,
  onFormChange,
}: DefaultValueProps) => {
  const { t } = useTranslation()
  const getFormChangeHandler = useCallback(({ key, type }: DefaultValueForm) => {
    return (payload: any) => {
      let value
      if (type === VarType.string || type === VarType.number)
        value = payload.target.value

      if (type === VarType.array || type === VarType.arrayNumber || type === VarType.arrayString || type === VarType.arrayObject || type === VarType.arrayFile || type === VarType.object)
        value = payload

      onFormChange({ key, type, value })
    }
  }, [onFormChange])

  return (
    <div className="px-4 pt-2">
      <div className="body-xs-regular mb-2 text-text-tertiary">
        {t('nodes.common.errorHandle.defaultValue.desc', { ns: 'workflow' })}
        &nbsp;
      </div>
      <div className="space-y-1">
        {
          forms.map((form, index) => {
            return (
              <div
                key={index}
                className="py-1"
              >
                <div className="mb-1 flex items-center">
                  <div className="system-sm-medium mr-1 text-text-primary">{form.key}</div>
                  <div className="system-xs-regular text-text-tertiary">{form.type}</div>
                </div>
                {
                  (form.type === VarType.string || form.type === VarType.number) && (
                    <Input
                      type={form.type}
                      value={form.value || (form.type === VarType.string ? '' : 0)}
                      onChange={getFormChangeHandler({ key: form.key, type: form.type })}
                    />
                  )
                }
                {
                  (
                    form.type === VarType.array
                    || form.type === VarType.arrayNumber
                    || form.type === VarType.arrayString
                    || form.type === VarType.arrayObject
                    || form.type === VarType.object
                  ) && (
                    <CodeEditor
                      language={CodeLanguage.json}
                      value={form.value}
                      onChange={getFormChangeHandler({ key: form.key, type: form.type })}
                    />
                  )
                }
              </div>
            )
          })
        }
      </div>
    </div>
  )
}

export default DefaultValue
