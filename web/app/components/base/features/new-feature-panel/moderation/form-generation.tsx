import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import type { CodeBasedExtensionForm } from '@/models/common'
import I18n from '@/context/i18n'
import { PortalSelect } from '@/app/components/base/select'
import Textarea from '@/app/components/base/textarea'
import type { ModerationConfig } from '@/models/debug'

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
  const { locale } = useContext(I18n)

  const handleFormChange = (type: string, v: string) => {
    onChange({ ...value, [type]: v })
  }

  return (
    <>
      {
        forms.map((form, index) => (
          <div
            key={index}
            className='py-2'
          >
            <div className='flex items-center h-9 text-sm font-medium text-gray-900'>
              {locale === 'zh-Hans' ? form.label['zh-Hans'] : form.label['en-US']}
            </div>
            {
              form.type === 'text-input' && (
                <input
                  value={value?.[form.variable] || ''}
                  className='block px-3 w-full h-9 bg-gray-100 rounded-lg text-sm text-gray-900 outline-none appearance-none'
                  placeholder={form.placeholder}
                  onChange={e => handleFormChange(form.variable, e.target.value)}
                />
              )
            }
            {
              form.type === 'paragraph' && (
                <div className='relative'>
                  <Textarea
                    className='resize-none'
                    value={value?.[form.variable] || ''}
                    placeholder={form.placeholder}
                    onChange={e => handleFormChange(form.variable, e.target.value)}
                  />
                </div>
              )
            }
            {
              form.type === 'select' && (
                <PortalSelect
                  value={value?.[form.variable]}
                  items={form.options.map((option) => {
                    return {
                      name: option.label[locale === 'zh-Hans' ? 'zh-Hans' : 'en-US'],
                      value: option.value,
                    }
                  })}
                  onSelect={item => handleFormChange(form.variable, item.value as string)}
                  popupClassName='w-[576px] !z-[102]'
                />
              )
            }
          </div>
        ))
      }
    </>
  )
}

export default FormGeneration
