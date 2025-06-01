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

  // 添加调试日志
  console.log('ConditionCommonVariableSelector - variables:', variables)
  console.log('ConditionCommonVariableSelector - varType:', varType)

  // 过滤变量，支持数组类型
  const filteredVariables = variables.filter((v) => {
    // 如果是数组类型变量，始终显示
    const isArrayType = v.type === 'array' || v.type.startsWith('array')

    // 如果是指定类型或数组类型，则显示
    return v.type === varType || isArrayType
  })

  console.log('ConditionCommonVariableSelector - filteredVariables:', filteredVariables)

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
        if (!filteredVariables.length) return
        setOpen(!open)
      }}>
        <div className="flex h-6 grow cursor-pointer items-center">
          {
            selected && (
              <div className='system-xs-medium inline-flex h-6 items-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark pl-[5px] pr-1.5 text-text-secondary shadow-xs'>
                <Variable02 className='mr-1 h-3.5 w-3.5 text-text-accent' />
                {selected.name}
              </div>
            )
          }
          {
            !selected && (
              <>
                <div className='system-sm-regular flex grow items-center text-components-input-text-placeholder'>
                  <Variable02 className='mr-1 h-4 w-4' />
                  {t('workflow.nodes.knowledgeRetrieval.metadata.panel.select')}
                </div>
                <div className='system-2xs-medium flex h-5 shrink-0 items-center rounded-[5px] border border-divider-deep px-[5px] text-text-tertiary'>
                  {varType}
                </div>
              </>
            )
          }
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className='w-[200px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg'>
          {
            filteredVariables.length > 0 ? (
              filteredVariables.map(v => (
                <div
                  key={v.name}
                  className='system-xs-medium flex h-6 cursor-pointer items-center rounded-md px-2 text-text-secondary hover:bg-state-base-hover'
                  onClick={() => handleChange(v.name)}
                >
                  <Variable02 className='mr-1 h-4 w-4 text-text-accent' />
                  {v.name}
                </div>
              ))
            ) : (
              <div className='system-xs-medium flex h-6 items-center px-2 text-text-tertiary'>
                {t('workflow.nodes.knowledgeRetrieval.metadata.panel.noVariables')}
              </div>
            )
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ConditionCommonVariableSelector
