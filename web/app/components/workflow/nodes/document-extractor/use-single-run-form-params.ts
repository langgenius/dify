import type { MutableRefObject } from 'react'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import type { DocExtractorNodeType } from './types'
import { useTranslation } from 'react-i18next'
import { InputVarType } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.docExtractor'

type Params = {
  id: string,
  payload: DocExtractorNodeType,
  runInputData: Record<string, any>
  runInputDataRef: MutableRefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
}
const useSingleRunFormParams = ({
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
          label: t(`${i18nPrefix}.inputVar`)!,
          variable: 'files',
          type: InputVarType.multiFiles,
          required: true,
        }],
        values: { files },
        onChange: (keyValue: Record<string, any>) => setFiles(keyValue.files),
      },
    ]
  }, [files, setFiles, t])

  return {
    forms,
  }
}

export default useSingleRunFormParams
