import type { DefaultValueForm } from './types'
import Input from '@/app/components/base/input'
import { VarType } from '@/app/components/workflow/types'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'

type DefaultValueProps = {
  forms: DefaultValueForm[]
  onFormChange: (form: DefaultValueForm) => void
}
const DefaultValue = ({
  forms,
  onFormChange,
}: DefaultValueProps) => {
  return (
    <div className='px-4 pt-2'>
      <div className='mb-2 body-xs-regular text-text-tertiary'>On error, will return below value</div>
      <div className='space-y-1'>
        {
          forms.map((form, index) => {
            return (
              <div
                key={index}
                className='py-1'
              >
                <div className='flex items-center mb-1'>
                  <div className='mr-1 system-sm-medium text-text-primary'>{form.key}</div>
                  <div className='system-xs-regular text-text-tertiary'>{form.type}</div>
                </div>
                {
                  (form.type === VarType.string || form.type === VarType.number) && (
                    <Input
                      type={form.type}
                      value={form.value || (form.type === VarType.string ? '' : 0)}
                      onChange={e => onFormChange({ key: form.key, type: form.type, value: e.target.value })}
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
                      value={form.value ? JSON.stringify(form.value) : (form.type === VarType.object ? '{}' : '[]')}
                      onChange={v => onFormChange({ key: form.key, type: form.type, value: JSON.parse(v) })}
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
