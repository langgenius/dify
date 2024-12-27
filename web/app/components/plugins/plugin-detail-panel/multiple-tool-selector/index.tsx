import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
  RiArrowDropDownLine,
  RiQuestionLine,
} from '@remixicon/react'
import type { ToolValue } from '@/app/components/plugins/plugin-detail-panel/tool-selector'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import Divider from '@/app/components/base/divider'
import cn from '@/utils/classnames'

type Props = {
  disabled?: boolean
  value: ToolValue[]
  label: string
  required?: boolean
  tooltip?: any
  supportCollapse?: boolean
  onChange: (value: ToolValue[]) => void
  scope?: string
}

const MultipleToolSelector = ({
  value,
  label,
  required,
  tooltip,
  supportCollapse,
}: Props) => {
  const { t } = useTranslation()
  const [collapse, setCollapse] = React.useState(false)

  const handleCollapse = () => {
    if (supportCollapse)
      setCollapse(!collapse)
  }

  return (
    <>
      <div className='flex items-center mb-1'>
        <div
          className={cn('relative grow flex items-center gap-0.5', supportCollapse && 'cursor-pointer')}
          onClick={handleCollapse}
        >
          <div className='h-6 flex items-center text-text-secondary system-sm-semibold-uppercase'>{label}</div>
          {required && <div className='text-error-main'>*</div>}
          {tooltip && (
            <Tooltip
              popupContent={tooltip}
              needsDelay
            >
              <div><RiQuestionLine className='w-3.5 h-3.5 text-text-quaternary hover:text-text-tertiary'/></div>
            </Tooltip>
          )}
          {supportCollapse && (
            <div className='absolute -left-4 top-1'>
              <RiArrowDropDownLine
                className={cn(
                  'w-4 h-4 text-text-tertiary',
                  collapse && 'transform -rotate-90',
                )}
              />
            </div>
          )}
        </div>
        {value.length > 0 && (
          <>
            <div className='flex items-center gap-1 text-text-tertiary system-xs-medium'>
              <span>{`${value.length}/${value.length}`}</span>
              <span>{t('appDebug.agent.tools.enabled')}</span>
            </div>
            <Divider type='vertical' className='ml-3 mr-1 h-3' />
          </>
        )}
        <ActionButton className='mx-1' onClick={() => {}}>
          <RiAddLine className='w-4 h-4' />
        </ActionButton>
      </div>
      {!collapse && (
        <>
          {value.length === 0 && (
            <div className='p-3 flex justify-center rounded-[10px] bg-background-section text-text-tertiary system-xs-regular'>{t('plugin.detailPanel.toolSelector.empty')}</div>
          )}
        </>
      )}
    </>
  )
}

export default MultipleToolSelector
