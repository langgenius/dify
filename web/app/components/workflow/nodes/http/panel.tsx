import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import { mockData } from './mock'
import ApiInput from './components/api-input'
import KeyValue from './components/key-value'
import EditBody from './components/edit-body'
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
    isHeaderKeyValueEdit,
    toggleIsHeaderKeyValueEdit,
    params,
    setParams,
    addParam,
    isParamKeyValueEdit,
    toggleIsParamKeyValueEdit,
    setBody,
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
          <KeyValue
            list={headers}
            onChange={setHeaders}
            onAdd={addHeader}
            readonly={readOnly}
            isKeyValueEdit={isHeaderKeyValueEdit}
            toggleKeyValueEdit={toggleIsHeaderKeyValueEdit}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.params`)}
        >
          <KeyValue
            list={params}
            onChange={setParams}
            onAdd={addParam}
            readonly={readOnly}
            isKeyValueEdit={isParamKeyValueEdit}
            toggleKeyValueEdit={toggleIsParamKeyValueEdit}
          />
        </Field>
        <Field
          title={t(`${i18nPrefix}.body`)}
        >
          <EditBody
            readonly={readOnly}
            payload={inputs.body}
            onChange={setBody}
          />
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
