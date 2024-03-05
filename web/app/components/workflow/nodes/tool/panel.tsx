import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Split from '../_base/components/split'
import type { ToolNodeType } from './types'
import Button from '@/app/components/base/button'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { NodeProps } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.tool'

const Panel: FC<NodeProps<ToolNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const readOnly = false

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
      </div>
      <Split />
    </div>
  )
}

export default React.memo(Panel)
