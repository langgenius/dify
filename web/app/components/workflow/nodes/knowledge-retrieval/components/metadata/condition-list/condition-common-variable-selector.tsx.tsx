import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { VarType } from '@/app/components/workflow/types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'

type ConditionCommonVariableSelectorProps = {
  variables?: { name: string; type: string }[]
  value?: string | number
  varType?: VarType
  onChange: (v: string) => void
}

const ConditionCommonVariableSelector = ({
  variables = [],
  value,
  onChange,
  varType,
}: ConditionCommonVariableSelectorProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const selected = variables.find(v => v.name === value)
  const handleChange = useCallback((v: string) => {
    onChange(v)
    setOpen(false)
  }, [onChange])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger asChild onClick={() => {
        if (!variables.length) return
        setOpen(!open)
      }}>
        <div className="grow flex items-center cursor-pointer h-6">
          {
            selected && (
              <div className='inline-flex items-center pl-[5px] pr-1.5 h-6 text-text-secondary rounded-md system-xs-medium border-[0.5px] border-components-panel-border-subtle shadow-xs bg-components-badge-white-to-dark'>
                <Variable02 className='mr-1 w-3.5 h-3.5 text-text-accent' />
                {selected.name}
              </div>
            )
          }
          {
            !selected && (
              <>
                <div className='grow flex items-center text-components-input-text-placeholder system-sm-regular'>
                  <Variable02 className='mr-1 w-4 h-4' />
                  {t('workflow.nodes.knowledgeRetrieval.metadata.panel.select')}
                </div>
                <div className='shrink-0 flex items-center px-[5px] h-5 border border-divider-deep rounded-[5px] system-2xs-medium text-text-tertiary'>
                  {varType}
                </div>
              </>
            )
          }
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className='p-1 w-[200px] bg-components-panel-bg-blur rounded-lg border-[0.5px] border-components-panel-border shadow-lg'>
          {
            variables.map(v => (
              <div
                key={v.name}
                className='flex items-center px-2 h-6 cursor-pointer rounded-md text-text-secondary system-xs-medium hover:bg-state-base-hover'
                onClick={() => handleChange(v.name)}
              >
                <Variable02 className='mr-1 w-4 h-4 text-text-accent' />
                {v.name}
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ConditionCommonVariableSelector
