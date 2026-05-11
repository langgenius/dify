import type { FC } from 'react'
import type { CodeBasedExtensionForm } from '@/models/common'
import type { ModerationConfig } from '@/models/debug'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import Textarea from '@/app/components/base/textarea'
import { useLocale } from '@/context/i18n'

type FormGenerationProps = {
  forms: CodeBasedExtensionForm[]
  value: ModerationConfig['config']
  onChange: (v: Record<string, string>) => void
}
const FormGeneration: FC<FormGenerationProps> = ({
  forms,
  value,
  onChange,
}) => {
  const locale = useLocale()

  const handleFormChange = (type: string, v: string) => {
    onChange({ ...value, [type]: v })
  }

  return (
    <>
      {
        forms.map((form, index) => {
          const selectOptions = form.type === 'select'
            ? form.options.map(option => ({
                name: option.label[locale === 'zh-Hans' ? 'zh-Hans' : 'en-US'],
                value: option.value,
              }))
            : []
          const selectedOption = selectOptions.find(option => option.value === value?.[form.variable]) ?? null

          return (
            <div
              key={index}
              className="py-2"
            >
              <div className="flex h-9 items-center text-sm font-medium text-text-primary">
                {locale === 'zh-Hans' ? form.label['zh-Hans'] : form.label['en-US']}
              </div>
              {
                form.type === 'text-input' && (
                  <input
                    value={value?.[form.variable] || ''}
                    className="block h-9 w-full appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-text-primary outline-hidden"
                    placeholder={form.placeholder}
                    onChange={e => handleFormChange(form.variable, e.target.value)}
                  />
                )
              }
              {
                form.type === 'paragraph' && (
                  <div className="relative">
                    <Textarea
                      className="resize-none"
                      value={value?.[form.variable] || ''}
                      placeholder={form.placeholder}
                      onChange={e => handleFormChange(form.variable, e.target.value)}
                    />
                  </div>
                )
              }
              {
                form.type === 'select' && (
                  <Select value={selectedOption?.value ?? null} onValueChange={nextValue => nextValue && handleFormChange(form.variable, nextValue)}>
                    <SelectTrigger className="w-full">
                      {selectedOption?.name ?? form.placeholder}
                    </SelectTrigger>
                    <SelectContent>
                      {selectOptions.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          <SelectItemText>{option.name}</SelectItemText>
                          <SelectItemIndicator />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              }
            </div>
          )
        })
      }
    </>
  )
}

export default FormGeneration
