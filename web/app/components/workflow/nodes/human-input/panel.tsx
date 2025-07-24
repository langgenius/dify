import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { HumanInputNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.humanInput'

const Panel: FC<NodePanelProps<HumanInputNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  return (
    <div className='mt-2'>
      <div className='space-y-4 px-4 pb-4'>
        TODO
      </div>
    </div>
  )
}

export default React.memo(Panel)
