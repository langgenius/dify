import { useTranslation } from 'react-i18next'
import {
  RiArrowGoBackLine,
  RiCloseLine,
  RiMenuLine,
} from '@remixicon/react'
import { useStore } from '../store'
import type { BlockEnum } from '../types'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import Empty from './empty'
import ValueContent from './value-content'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Tooltip from '@/app/components/base/tooltip'
import BlockIcon from '@/app/components/workflow/block-icon'
import Loading from '@/app/components/base/loading'
import type { currentVarType } from './panel'
import { VarInInspectType } from '@/types/workflow'
import cn from '@/utils/classnames'
import { VariableIconWithColor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'

type Props = {
  currentNodeVar?: currentVarType
  handleOpenMenu: () => void
  isValueFetching?: boolean
}

const Right = ({
  currentNodeVar,
  handleOpenMenu,
  isValueFetching,
}: Props) => {
  const { t } = useTranslation()
  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)
  const setCurrentFocusNodeId = useStore(s => s.setCurrentFocusNodeId)

  const {
    resetConversationVar,
    resetToLastRunVar,
    editInspectVarValue,
  } = useCurrentVars()

  const handleValueChange = (varId: string, value: any) => {
    if (!currentNodeVar) return
    editInspectVarValue(currentNodeVar.nodeId, varId, value)
  }

  const resetValue = () => {
    if (!currentNodeVar) return
    resetToLastRunVar(currentNodeVar.nodeId, currentNodeVar.var.id)
  }

  const handleClose = () => {
    setShowVariableInspectPanel(false)
    setCurrentFocusNodeId('')
  }

  const handleClear = () => {
    if (!currentNodeVar) return
    resetConversationVar(currentNodeVar.var.id)
  }

  const getCopyContent = () => {
    const value = currentNodeVar?.var.value
    if (value === null || value === undefined)
      return ''

    if (typeof value === 'object')
      return JSON.stringify(value)

    return String(value)
  }

  return (
    <div className={cn('flex h-full flex-col')}>
      {/* header */}
      <div className='flex shrink-0 items-center justify-between gap-1 px-2 pt-2'>
        {bottomPanelWidth < 488 && (
          <ActionButton className='shrink-0' onClick={handleOpenMenu}>
            <RiMenuLine className='h-4 w-4' />
          </ActionButton>
        )}
        <div className='flex w-0 grow items-center gap-1'>
          {currentNodeVar && (
            <>
              {
                [VarInInspectType.environment, VarInInspectType.conversation, VarInInspectType.system].includes(currentNodeVar.nodeType as VarInInspectType) && (
                  <VariableIconWithColor
                    variableCategory={currentNodeVar.nodeType as VarInInspectType}
                    className='size-4'
                  />
                )
              }
              {currentNodeVar.nodeType !== VarInInspectType.environment && currentNodeVar.nodeType !== VarInInspectType.conversation && currentNodeVar.nodeType !== VarInInspectType.system && (
                <>
                  <BlockIcon
                    className='shrink-0'
                    type={currentNodeVar.nodeType as BlockEnum}
                    size='xs'
                  />
                  <div className='system-sm-regular shrink-0 text-text-secondary'>{currentNodeVar.title}</div>
                  <div className='system-sm-regular shrink-0 text-text-quaternary'>/</div>
                </>
              )}
              <div title={currentNodeVar.var.name} className='system-sm-semibold truncate text-text-secondary'>{currentNodeVar.var.name}</div>
              <div className='system-xs-medium ml-1 shrink-0 text-text-tertiary'>{currentNodeVar.var.value_type}</div>
            </>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          {currentNodeVar && (
            <>
              {currentNodeVar.var.edited && (
                <Badge>
                  <span className='ml-[2.5px] mr-[4.5px] h-[3px] w-[3px] rounded bg-text-accent-secondary'></span>
                  <span className='system-2xs-semibold-uupercase'>{t('workflow.debug.variableInspect.edited')}</span>
                </Badge>
              )}
              {currentNodeVar.var.edited && currentNodeVar.var.type !== VarInInspectType.conversation && (
                <Tooltip popupContent={t('workflow.debug.variableInspect.reset')}>
                  <ActionButton onClick={resetValue}>
                    <RiArrowGoBackLine className='h-4 w-4' />
                  </ActionButton>
                </Tooltip>
              )}
              {currentNodeVar.var.edited && currentNodeVar.var.type === VarInInspectType.conversation && (
                <Tooltip popupContent={t('workflow.debug.variableInspect.resetConversationVar')}>
                  <ActionButton onClick={handleClear}>
                    <RiArrowGoBackLine className='h-4 w-4' />
                  </ActionButton>
                </Tooltip>
              )}
              {currentNodeVar.var.value_type !== 'secret' && (
                <CopyFeedback content={getCopyContent()} />
              )}
            </>
          )}
          <ActionButton onClick={handleClose}>
            <RiCloseLine className='h-4 w-4' />
          </ActionButton>
        </div>
      </div>
      {/* content */}
      <div className='grow p-2'>
        {!currentNodeVar && <Empty />}
        {isValueFetching && (
          <div className='flex h-full items-center justify-center'>
            <Loading />
          </div>
        )}
        {currentNodeVar && !isValueFetching && <ValueContent currentVar={currentNodeVar.var} handleValueChange={handleValueChange} />}
      </div>
    </div>
  )
}

export default Right
