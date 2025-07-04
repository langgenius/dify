import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Split from '../_base/components/split'
import type { ToolNodeType } from './types'
import useConfig from './use-config'
import InputVarList from './components/input-var-list'
import Button from '@/app/components/base/button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'
import ConfigCredential from '@/app/components/tools/setting/build-in/config-credentials'
import Loading from '@/app/components/base/loading'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import StructureOutputItem from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import { Type } from '../llm/types'

const i18nPrefix = 'workflow.nodes.tool'

const Panel: FC<NodePanelProps<ToolNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    toolInputVarSchema,
    setInputVar,
    handleOnVarOpen,
    filterVar,
    toolSettingSchema,
    toolSettingValue,
    setToolSettingValue,
    currCollection,
    isShowAuthBtn,
    showSetAuth,
    showSetAuthModal,
    hideSetAuthModal,
    handleSaveAuth,
    isLoading,
    outputSchema,
    hasObjectOutput,
    currTool,
  } = useConfig(id, data)

  if (isLoading) {
    return <div className='flex h-[200px] items-center justify-center'>
      <Loading />
    </div>
  }

  return (
    <div className='pt-2'>
      {!readOnly && isShowAuthBtn && (
        <>
          <div className='px-4'>
            <Button
              variant='primary'
              className='w-full'
              onClick={showSetAuthModal}
            >
              {t(`${i18nPrefix}.authorize`)}
            </Button>
          </div>
        </>
      )}
      {!isShowAuthBtn && <>
        <div className='space-y-4 px-4'>
          {toolInputVarSchema.length > 0 && (
            <Field
              title={t(`${i18nPrefix}.inputVars`)}
            >
              <InputVarList
                readOnly={readOnly}
                nodeId={id}
                schema={toolInputVarSchema as any}
                value={inputs.tool_parameters}
                onChange={setInputVar}
                filterVar={filterVar}
                isSupportConstantValue
                onOpen={handleOnVarOpen}
                currentProvider={currCollection}
                currentTool={currTool}
              />
            </Field>
          )}

          {toolInputVarSchema.length > 0 && toolSettingSchema.length > 0 && (
            <Split />
          )}

          <Form
            className='space-y-4'
            itemClassName='!py-0'
            fieldLabelClassName='!text-[13px] !font-semibold !text-text-secondary uppercase'
            value={toolSettingValue}
            onChange={setToolSettingValue}
            formSchemas={toolSettingSchema as any}
            isEditMode={false}
            showOnVariableMap={{}}
            validating={false}
            // inputClassName='!bg-gray-50'
            readonly={readOnly}
          />
        </div>
      </>}

      {showSetAuth && (
        <ConfigCredential
          collection={currCollection!}
          onCancel={hideSetAuthModal}
          onSaved={handleSaveAuth}
          isHideRemoveBtn
        />
      )}

      <div>
        <OutputVars>
          <>
            <VarItem
              name='text'
              type='string'
              description={t(`${i18nPrefix}.outputVars.text`)}
              isIndent={hasObjectOutput}
            />
            <VarItem
              name='files'
              type='array[file]'
              description={t(`${i18nPrefix}.outputVars.files.title`)}
              isIndent={hasObjectOutput}
            />
            <VarItem
              name='json'
              type='array[object]'
              description={t(`${i18nPrefix}.outputVars.json`)}
              isIndent={hasObjectOutput}
            />
            {outputSchema.map(outputItem => (
              <div key={outputItem.name}>
                {outputItem.value?.type === 'object' ? (
                  <StructureOutputItem
                    rootClassName='code-sm-semibold text-text-secondary'
                    payload={{
                      schema: {
                        type: Type.object,
                        properties: {
                          [outputItem.name]: outputItem.value,
                        },
                        additionalProperties: false,
                      },
                    }} />
                ) : (
                  <VarItem
                    name={outputItem.name}
                    type={outputItem.type.toLocaleLowerCase()}
                    description={outputItem.description}
                    isIndent={hasObjectOutput}
                  />
                )}
              </div>
            ))}
          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
