import type { FC } from 'react'
import type { NodeProps } from 'reactflow'
import type { HumanInputNodeType } from './types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { NodeSourceHandle } from '../_base/components/node-handle'

const i18nPrefix = 'nodes.humanInput'

const Node: FC<NodeProps<HumanInputNodeType>> = (props) => {
  const { data } = props
  const { t } = useTranslation()
  const { pause_reason } = data

  return (
    <div className="mb-1 px-3 py-2">
      <div className="mb-1 flex items-center gap-1">
        <div className="text-xs font-medium text-gray-500">
          {t(`${i18nPrefix}.pauseReason`, { ns: 'workflow' })}
        </div>
      </div>
      {pause_reason && (
        <div className="mb-2 text-xs leading-relaxed text-gray-700">
          {pause_reason}
        </div>
      )}
      {!pause_reason && (
        <div className="mb-2 text-xs italic text-gray-400">
          {t(`${i18nPrefix}.pauseReasonPlaceholder`, { ns: 'workflow' })}
        </div>
      )}
      {/* Approve Branch */}
      <div className="relative flex h-6 items-center px-1">
        <div
          className="w-full text-right text-xs font-semibold text-text-success"
          aria-label={t(`${i18nPrefix}.approve`, { ns: 'workflow' })}
        >
          {t(`${i18nPrefix}.approve`, { ns: 'workflow' })}
        </div>
        <NodeSourceHandle
          {...props}
          handleId="approve"
          handleClassName="!top-1/2 !-right-[21px] !-translate-y-1/2"
        />
      </div>
      {/* Reject Branch */}
      <div className="relative flex h-6 items-center px-1">
        <div
          className="w-full text-right text-xs font-semibold text-text-destructive"
          aria-label={t(`${i18nPrefix}.reject`, { ns: 'workflow' })}
        >
          {t(`${i18nPrefix}.reject`, { ns: 'workflow' })}
        </div>
        <NodeSourceHandle
          {...props}
          handleId="reject"
          handleClassName="!top-1/2 !-right-[21px] !-translate-y-1/2"
        />
      </div>
    </div>
  )
}

export default React.memo(Node)
