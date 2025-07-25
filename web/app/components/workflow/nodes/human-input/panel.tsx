import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import useConfig from './use-config'
import type { HumanInputNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import Divider from '@/app/components/base/divider'
import TimeoutInput from './components/timeout'

const i18nPrefix = 'workflow.nodes.humanInput'

const Panel: FC<NodePanelProps<HumanInputNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()
  const {
    inputs,
    handleTimeoutChange,
  } = useConfig(id, data)
  return (
    <div className='py-2'>
      <div className='px-4 py-2'>
        <Divider className='!my-0 !h-px !bg-divider-subtle' />
      </div>
      <div className='flex items-center justify-between px-4 py-2'>
        <div className='system-sm-semibold-uppercase text-text-secondary'>{t(`${i18nPrefix}.timeout.title`)}</div>
        <TimeoutInput
          timeout={inputs.timeout}
          onChange={handleTimeoutChange}
        />
      </div>
    </div>
  )
}

export default React.memo(Panel)
