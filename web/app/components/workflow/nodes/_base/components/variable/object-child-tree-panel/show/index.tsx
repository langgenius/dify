'use client'
import type { FC } from 'react'
import type { StructuredOutput } from '../../../../../llm/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Field from './field'

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
      description: t('structOutput.LLMResponse', { ns: 'app' }),
    },
  }
  return (
    <div className="relative left-[-7px]">
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
