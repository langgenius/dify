import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Split from '../_base/components/split'
import type { ToolNodeType } from './types'
import useConfig from './use-config'
import Button from '@/app/components/base/button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Form from '@/app/components/header/account-setting/model-provider-page/model-modal/Form'

const i18nPrefix = 'workflow.nodes.tool'

const Panel: FC<NodePanelProps<ToolNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const readOnly = false

  const {
    inputs,
    toolSettingSchema,
    toolSettingValue,
    setToolSettingValue,
  } = useConfig(id, data)

  return (
    <div className='mt-2'>
      {!readOnly && (
        <>
          <div className='px-4 pb-3'>
            <Button
              type='primary'
              className='w-full !h-8'>
              {t(`${i18nPrefix}.toAuthorize`)}
            </Button>
          </div>
          <Split className='mb-2' />
        </>
      )}

      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.inputVars`)}
        >
          inputVars
        </Field>
        <Split />
        <Form
          className='space-y-4'
          itemClassName='!py-0'
          fieldLabelClassName='!text-[13px] !font-semibold !text-gray-700 uppercase'
          value={toolSettingValue}
          onChange={setToolSettingValue}
          formSchemas={toolSettingSchema as any}
          isEditMode={false}
          showOnVariableMap={{}}
          validating={false}
          inputClassName='!bg-gray-50'
          readonly={readOnly}
        />
      </div>
    </div>
  )
}

export default React.memo(Panel)
