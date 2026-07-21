import type { FC } from 'react'
import type { HumanInputNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
import { RiMailSendFill, RiRobot2Fill } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { isLegacyHumanInputNodeData } from '../human-input-v2/migration/policy'
import HumanInputNodeBranches from './shared/node-branches'
import { DeliveryMethodType } from './types'

const i18nPrefix = 'nodes.humanInput'

const Node: FC<NodeProps<HumanInputNodeType>> = (props) => {
  const { t } = useTranslation()

  const { data } = props
  const deliveryMethods = data.delivery_methods

  return (
    <>
      {isLegacyHumanInputNodeData(data) && (
        <div className="px-2.5 pb-1">
          <Badge
            text={t(($) => $['nodes.humanInputMigration.oldVersion'], { ns: 'workflow' })}
            className="border-text-warning-secondary text-text-warning-secondary"
          />
        </div>
      )}
      {deliveryMethods.length > 0 && (
        <div className="space-y-0.5 py-1">
          <div className="px-2.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
            {t(($) => $[`${i18nPrefix}.deliveryMethod.title`], { ns: 'workflow' })}
          </div>
          <div className="space-y-0.5 px-2.5">
            {deliveryMethods.map((method) => (
              <div
                key={method.type}
                className="flex items-center gap-1 rounded-md bg-workflow-block-parma-bg p-1"
              >
                {method.type === DeliveryMethodType.WebApp && (
                  <div className="rounded-sm border border-divider-regular bg-components-icon-bg-indigo-solid p-0.5">
                    <RiRobot2Fill className="size-3.5 text-text-primary-on-surface" />
                  </div>
                )}
                {method.type === DeliveryMethodType.Email && (
                  <div className="rounded-sm border border-divider-regular bg-components-icon-bg-blue-solid p-0.5">
                    <RiMailSendFill className="size-3.5 text-text-primary-on-surface" />
                  </div>
                )}
                <span className="system-xs-regular text-text-secondary capitalize">
                  {method.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <HumanInputNodeBranches {...props} />
    </>
  )
}

export default React.memo(Node)
