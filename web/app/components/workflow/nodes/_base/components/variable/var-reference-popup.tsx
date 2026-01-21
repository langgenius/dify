'use client'
import type { FC } from 'react'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ListEmpty from '@/app/components/base/list-empty'
import { useStore } from '@/app/components/workflow/store'
import { useDocLink } from '@/context/i18n'
import VarReferenceVars from './var-reference-vars'

type Props = {
  vars: NodeOutPutVar[]
  popupFor?: 'assigned' | 'toAssigned'
  onChange: (value: ValueSelector, varDetail: Var) => void
  itemWidth?: number
  isSupportFileVar?: boolean
  zIndex?: number
  preferSchemaType?: boolean
}
const VarReferencePopup: FC<Props> = ({
  vars,
  popupFor,
  onChange,
  itemWidth,
  isSupportFileVar = true,
  zIndex,
  preferSchemaType,
}) => {
  const { t } = useTranslation()
  const pipelineId = useStore(s => s.pipelineId)
  const showManageRagInputFields = useMemo(() => !!pipelineId, [pipelineId])
  const setShowInputFieldPanel = useStore(s => s.setShowInputFieldPanel)
  const docLink = useDocLink()
  // max-h-[300px] overflow-y-auto todo: use portal to handle long list
  return (
    <div
      className="space-y-1 rounded-lg border border-components-panel-border bg-components-panel-bg p-1 shadow-lg"
      style={{
        width: itemWidth || 228,
      }}
    >
      {((!vars || vars.length === 0) && popupFor)
        ? (popupFor === 'toAssigned'
            ? (
                <ListEmpty
                  title={t('variableReference.noAvailableVars', { ns: 'workflow' }) || ''}
                  description={(
                    <div className="system-xs-regular text-text-tertiary">
                      {t('variableReference.noVarsForOperation', { ns: 'workflow' })}
                    </div>
                  )}
                />
              )
            : (
                <ListEmpty
                  title={t('variableReference.noAssignedVars', { ns: 'workflow' }) || ''}
                  description={(
                    <div className="system-xs-regular text-text-tertiary">
                      {t('variableReference.assignedVarsDescription', { ns: 'workflow' })}
                      <a
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-accent-secondary"
                        href={docLink('/guides/workflow/variables#conversation-variables', {
                          'zh-Hans': '/guides/workflow/variables#会话变量',
                          'ja-JP': '/guides/workflow/variables#会話変数',
                        })}
                      >
                        {t('variableReference.conversationVars', { ns: 'workflow' })}
                      </a>
                    </div>
                  )}
                />
              ))
        : (
            <VarReferenceVars
              searchBoxClassName="mt-1"
              vars={vars}
              onChange={onChange}
              itemWidth={itemWidth}
              isSupportFileVar={isSupportFileVar}
              zIndex={zIndex}
              showManageInputField={showManageRagInputFields}
              onManageInputField={() => setShowInputFieldPanel?.(true)}
              preferSchemaType={preferSchemaType}
            />
          )}
    </div>
  )
}
export default React.memo(VarReferencePopup)
