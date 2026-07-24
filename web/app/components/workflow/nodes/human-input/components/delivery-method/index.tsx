import type { DeliveryMethod, DeliveryMethodType, FormInputItem } from '../../types'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { produce } from 'immer'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks'
import MethodItem from './method-item'
import MethodSelector from './method-selector'
import UpgradeModal from './upgrade-modal'

const i18nPrefix = 'nodes.humanInput'

type Props = {
  nodeId: string
  value: DeliveryMethod[]
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  formContent?: string
  formInputs?: FormInputItem[]
  onChange: (value: DeliveryMethod[]) => void
  readonly?: boolean
}

const DeliveryMethodForm: React.FC<Props> = ({
  nodeId,
  value,
  nodesOutputVars,
  availableNodes,
  formContent,
  formInputs,
  onChange,
  readonly,
}) => {
  const { t } = useTranslation()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleMethodChange = (target: DeliveryMethod) => {
    const newMethods = produce(value, (draft) => {
      const index = draft.findIndex(method => method.type === target.type)
      if (index !== -1)
        draft[index] = target
    })
    onChange(newMethods)
    handleSyncWorkflowDraft(true, true)
  }

  const handleMethodAdd = (newMethod: DeliveryMethod) => {
    const newMethods = [...value, newMethod]
    onChange(newMethods)
  }

  const handleMethodDelete = (type: DeliveryMethodType) => {
    const newMethods = value.filter(method => method.type !== type)
    onChange(newMethods)
  }

  const [showUpgradeModal, setShowUpgradeModal] = React.useState(false)
  const handleShowUpgradeModal = () => {
    setShowUpgradeModal(true)
  }
  const handleCloseUpgradeModal = () => {
    setShowUpgradeModal(false)
  }

  return (
    <div className="px-4 py-2">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          <div className="system-sm-semibold-uppercase text-text-secondary">{t(`${i18nPrefix}.deliveryMethod.title`, { ns: 'workflow' })}</div>
          <Tooltip
            popupContent={t(`${i18nPrefix}.deliveryMethod.tooltip`, { ns: 'workflow' })}
          />
        </div>
        {!readonly && (
          <div className="flex items-center px-1">
            <MethodSelector
              data={value}
              onAdd={handleMethodAdd}
              onShowUpgradeTip={handleShowUpgradeModal}
            />
          </div>
        )}
      </div>
      {!value.length && (
        <div className="system-xs-regular flex items-center justify-center rounded-[10px] bg-background-section p-3 text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.emptyTip`, { ns: 'workflow' })}</div>
      )}
      {value.length > 0 && (
        <div className="space-y-1">
          {value.map(method => (
            <MethodItem
              nodeId={nodeId}
              method={method}
              key={method.id}
              onChange={handleMethodChange}
              onDelete={handleMethodDelete}
              nodesOutputVars={nodesOutputVars}
              availableNodes={availableNodes}
              formContent={formContent}
              formInputs={formInputs}
              readonly={readonly}
            />
          ))}
        </div>
      )}
      {showUpgradeModal && (
        <UpgradeModal
          isShow={showUpgradeModal}
          onClose={handleCloseUpgradeModal}
        />
      )}
    </div>
  )
}

export default DeliveryMethodForm
