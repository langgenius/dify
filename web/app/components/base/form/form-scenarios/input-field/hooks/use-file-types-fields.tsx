import { useTranslation } from 'react-i18next'
import { withForm } from '../../..'
import { type InputVar, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { getNewVarInWorkflow } from '@/utils/var'
import { useField } from '@tanstack/react-form'
import Label from '../../../components/label'
import FileTypeItem from '@/app/components/workflow/nodes/_base/components/file-type-item'
import { useCallback, useMemo } from 'react'

type FileTypesFieldsProps = {
  initialData?: InputVar
}

const UseFileTypesFields = ({
  initialData,
}: FileTypesFieldsProps) => {
  const FileTypesFields = useMemo(() => {
    return withForm({
      defaultValues: initialData || getNewVarInWorkflow(''),
      render: function Render({
        form,
      }) {
        const { t } = useTranslation()
        const allowFileTypesField = useField({ form, name: 'allowed_file_types' })
        const allowFileExtensionsField = useField({ form, name: 'allowed_file_extensions' })
        const { value: allowed_file_types = [] } = allowFileTypesField.state
        const { value: allowed_file_extensions = [] } = allowFileExtensionsField.state

        const handleSupportFileTypeChange = useCallback((type: SupportUploadFileTypes) => {
          let newAllowFileTypes = [...allowed_file_types]
          if (type === SupportUploadFileTypes.custom) {
            if (!newAllowFileTypes.includes(SupportUploadFileTypes.custom))
              newAllowFileTypes = [SupportUploadFileTypes.custom]
            else
              newAllowFileTypes = newAllowFileTypes.filter(v => v !== type)
          }
          else {
            newAllowFileTypes = newAllowFileTypes.filter(v => v !== SupportUploadFileTypes.custom)
            if (newAllowFileTypes.includes(type))
              newAllowFileTypes = newAllowFileTypes.filter(v => v !== type)
            else
              newAllowFileTypes.push(type)
          }
          allowFileTypesField.handleChange(newAllowFileTypes)
        }, [allowFileTypesField, allowed_file_types])

        const handleCustomFileTypesChange = useCallback((customFileTypes: string[]) => {
          allowFileExtensionsField.handleChange(customFileTypes)
        }, [allowFileExtensionsField])

        return (
          <div className='flex flex-col gap-y-0.5'>
            <Label
              htmlFor='allowed_file_types'
              label={t('appDebug.variableConfig.file.supportFileTypes')}
            />
            {
              [SupportUploadFileTypes.document, SupportUploadFileTypes.image, SupportUploadFileTypes.audio, SupportUploadFileTypes.video].map((type: SupportUploadFileTypes) => (
                <FileTypeItem
                  key={type}
                  type={type as SupportUploadFileTypes.image | SupportUploadFileTypes.document | SupportUploadFileTypes.audio | SupportUploadFileTypes.video}
                  selected={allowed_file_types.includes(type)}
                  onToggle={handleSupportFileTypeChange}
                />
              ))
            }
            <FileTypeItem
              type={SupportUploadFileTypes.custom}
              selected={allowed_file_types.includes(SupportUploadFileTypes.custom)}
              onToggle={handleSupportFileTypeChange}
              customFileTypes={allowed_file_extensions}
              onCustomFileTypesChange={handleCustomFileTypesChange}
            />
          </div>
        )
      },
    })
  }, [initialData])

  return FileTypesFields
}

export default UseFileTypesFields
