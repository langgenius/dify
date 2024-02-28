import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Split from '../_base/components/split'
import Button from '@/app/components/base/button'
import Field from '@/app/components/workflow/nodes/_base/components/field'

const i18nPrefix = 'workflow.nodes.tool'

const Panel: FC = () => {
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

export default Panel
