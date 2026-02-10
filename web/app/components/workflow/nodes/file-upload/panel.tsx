import type { FC } from 'react'
import type { FileUploadNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import useConfig from './use-config'

const i18nPrefix = 'nodes.fileUpload'

const Panel: FC<NodePanelProps<FileUploadNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const {
    readOnly,
    inputs,
    handleVarChanges,
    filterVar,
  } = useConfig(id, data)

  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-4">
        <Field
          title={t(`${i18nPrefix}.inputVar`, { ns: 'workflow' })}
          required
        >
          <VarReferencePicker
            readonly={readOnly}
            nodeId={id}
            isShowNodeName
            value={inputs.variable_selector || []}
            onChange={handleVarChanges}
            filterVar={filterVar}
            typePlaceHolder="File | Array[File]"
          />
        </Field>
      </div>
      <Split />
      <div>
        <OutputVars>
          <>
            <VarItem
              name="sandbox_path"
              type={inputs.is_array_file ? 'array[string]' : 'string'}
              description={t(`${i18nPrefix}.outputVars.sandboxPath`, { ns: 'workflow' })}
            />
            <VarItem
              name="file_name"
              type={inputs.is_array_file ? 'array[string]' : 'string'}
              description={t(`${i18nPrefix}.outputVars.fileName`, { ns: 'workflow' })}
            />
          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
