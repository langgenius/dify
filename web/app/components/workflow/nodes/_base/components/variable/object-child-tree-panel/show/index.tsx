'use client'
import type { FC } from 'react'
import React from 'react'
import type { StructuredOutput } from '../../../../../llm/types'
import Field from './field'
import { useTranslation } from 'react-i18next'

type Props = {
  payload: StructuredOutput
  rootClassName?: string
}

const ShowPanel: FC<Props> = ({
  payload,
  rootClassName,
}) => {
  const { t } = useTranslation()
  const schema = {
    ...payload,
    schema: {
      ...payload.schema,
      description: t('app.structOutput.LLMResponse'),
    },
  }
  return (
    <div className='relative left-[-7px]'>
      {Object.keys(schema.schema.properties!).map(name => (
        <Field
          key={name}
          name={name}
          payload={schema.schema.properties![name]}
          required={!!schema.schema.required?.includes(name)}
          rootClassName={rootClassName}
        />
      ))}
    </div>
  )
}
export default React.memo(ShowPanel)
