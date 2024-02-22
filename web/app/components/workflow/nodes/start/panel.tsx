import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'

const i18nPrefix = 'workflow.nodes.start'

const Panel: FC = () => {
  const { t } = useTranslation()

  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field
          title={t(`${i18nPrefix}.model`)}
        >
          ss
        </Field>
      </div>
      <Split />

      <div className='px-4 pt-4 pb-2'>
        <OutputVars title={t(`${i18nPrefix}.builtInVar`)!}>
          <>
            <VarItem
              name='sys.query'
              type='string'
              description={t(`${i18nPrefix}.outputVars.query`)}
            />
            <VarItem
              name='sys.memories'
              type='array[Object]'
              description={t(`${i18nPrefix}.outputVars.memories.des`)}
              subItems={[
                {
                  name: 'type',
                  type: 'string',
                  description: t(`${i18nPrefix}.outputVars.memories.type`),
                },
                {
                  name: 'content',
                  type: 'string',
                  description: t(`${i18nPrefix}.outputVars.memories.content`),
                },
              ]}
            />
            <VarItem
              name='sys.files'
              type='string'
              description={t(`${i18nPrefix}.outputVars.files`)}
            />
          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default Panel
