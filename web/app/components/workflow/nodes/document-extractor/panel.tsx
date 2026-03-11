import type { FC } from 'react'
import type { DocExtractorNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { BlockEnum } from '@/app/components/workflow/types'
import { useLocale } from '@/context/i18n'
import { LanguagesSupported } from '@/i18n-config/language'
import { useFileSupportTypes } from '@/service/use-common'
import OutputVars, { VarItem } from '../_base/components/output-vars'
import Split from '../_base/components/split'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import { useNodeHelpLink } from '../_base/hooks/use-node-help-link'
import useConfig from './use-config'

const i18nPrefix = 'nodes.docExtractor'

const Panel: FC<NodePanelProps<DocExtractorNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const link = useNodeHelpLink(BlockEnum.DocExtractor)
  const { data: supportFileTypesResponse } = useFileSupportTypes()
  const supportTypes = supportFileTypesResponse?.allowed_extensions || []
  const supportTypesShowNames = (() => {
    const extensionMap: { [key: string]: string } = {
      md: 'markdown',
      pptx: 'pptx',
      htm: 'html',
      xlsx: 'xlsx',
      docx: 'docx',
    }

    return [...supportTypes]
      .map(item => extensionMap[item] || item) // map to standardized extension
      .map(item => item.toLowerCase()) // convert to lower case
      .filter((item, index, self) => self.indexOf(item) === index) // remove duplicates
      .join(locale !== LanguagesSupported[1] ? ', ' : '、 ')
  })()
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
          <>
            <VarReferencePicker
              readonly={readOnly}
              nodeId={id}
              isShowNodeName
              value={inputs.variable_selector || []}
              onChange={handleVarChanges}
              filterVar={filterVar}
              typePlaceHolder="File | Array[File]"
            />
            <div className="body-xs-regular mt-1 py-0.5 text-text-tertiary">
              {t(`${i18nPrefix}.supportFileTypes`, { ns: 'workflow', types: supportTypesShowNames })}
              <a className="text-text-accent" href={link} target="_blank">{t(`${i18nPrefix}.learnMore`, { ns: 'workflow' })}</a>
            </div>
          </>
        </Field>
      </div>
      <Split />
      <div>
        <OutputVars>
          <VarItem
            name="text"
            type={inputs.is_array_file ? 'array[string]' : 'string'}
            description={t(`${i18nPrefix}.outputVars.text`, { ns: 'workflow' })}
          />
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
