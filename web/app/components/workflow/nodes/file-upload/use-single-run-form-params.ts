import type { RefObject } from 'react'
import type { FileUploadNodeType } from './types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { InputVarType } from '@/app/components/workflow/types'

const i18nPrefix = 'nodes.fileUpload'

type Params = {
  id: string
  payload: FileUploadNodeType
  runInputData: Record<string, unknown>
  runInputDataRef: RefObject<Record<string, unknown>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, unknown>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}

const useSingleRunFormParams = ({
  payload,
  runInputData,
  setRunInputData,
}: Params) => {
  const { t } = useTranslation()
  const files = runInputData.files

  const setFiles = useCallback((newFiles: []) => {
    setRunInputData({
      ...runInputData,
      files: newFiles,
    })
  }, [runInputData, setRunInputData])

  const forms = useMemo(() => {
    return [
      {
        inputs: [{
          label: t(`${i18nPrefix}.inputVar`, { ns: 'workflow' })!,
          variable: 'files',
          type: payload.is_array_file ? InputVarType.multiFiles : InputVarType.singleFile,
          required: true,
        }],
        values: { files },
        onChange: (keyValue: Record<string, unknown>) => setFiles((keyValue.files as []) || []),
      },
    ]
  }, [files, payload.is_array_file, setFiles, t])

  const getDependentVars = () => {
    return [payload.variable_selector]
  }

  const getDependentVar = (variable: string) => {
    if (variable === 'files')
      return payload.variable_selector
  }

  return {
    forms,
    getDependentVars,
    getDependentVar,
  }
}

export default useSingleRunFormParams
