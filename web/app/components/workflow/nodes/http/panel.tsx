import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import { mockData } from './mock'
import ApiInput from './components/api-input'
import KeyValueList from './components/key-value/list'
import VarList from '@/app/components/workflow/nodes/_base/components/variable/var-list'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import AddButton from '@/app/components/base/button/add-button'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'

const i18nPrefix = 'workflow.nodes.http'

const Panel: FC = () => {
  const { t } = useTranslation()
  const readOnly = false

  const {
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleMethodChange,
    handleUrlChange,
    headers,
    setHeaders,
    addHeader,
  } = useConfig(mockData)

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.inputVars`)}
          operations={
            <AddButton onClick={handleAddVariable} />
          }
        >
          <VarList
            readonly={readOnly}
            list={inputs.variables}
            onChange={handleVarListChange}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.api`)}
        >
          <ApiInput
            readonly={readOnly}
            method={inputs.method}
            onMethodChange={handleMethodChange}
            url={inputs.url}
            onUrlChange={handleUrlChange}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.headers`)}
        >
          <KeyValueList
            list={headers}
            onChange={setHeaders}
            onAdd={addHeader}
            readonly={readOnly}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.params`)}
        >
          params
        </Field>
        <Field
          title={t(`${i18nPrefix}.body`)}
        >
          body
        </Field>
      </div>
      <Split />
      <div className='px-4 pt-4 pb-2'>
        <OutputVars>
          <>
            <VarItem
              name='body'
              type='string'
              description={t(`${i18nPrefix}.outputVars.body`)}
            />
            <VarItem
              name='status_code'
              type='string'
              description={t(`${i18nPrefix}.outputVars.statusCode`)}
            />
            <VarItem
              name='headers'
              type='sting'
              description={t(`${i18nPrefix}.outputVars.headers`)}
            />
          </>
        </OutputVars>
      </div>
    </div >
  )
}

export default Panel
