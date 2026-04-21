import type { GlobalVariable } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { capitalize } from 'es-toolkit/string'

import { memo } from 'react'
import { GlobalVariable as GlobalVariableIcon } from '@/app/components/base/icons/src/vender/line/others'

type Props = {
  payload: GlobalVariable
}

const Item = ({
  payload,
}: Props) => {
  return (
    <div className={cn(
      'mb-1 rounded-lg border border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2.5 py-2 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover',
    )}
    >
      <div className="flex items-center justify-between">
        <div className="flex grow items-center gap-1">
          <GlobalVariableIcon className="h-4 w-4 text-util-colors-orange-orange-600" />
          <div className="system-sm-medium text-text-primary">
            <span className="text-text-tertiary">sys.</span>
            {payload.name}
          </div>
          <div className="system-xs-medium text-text-tertiary">{capitalize(payload.value_type)}</div>
        </div>
      </div>
      <div className="mt-1.5 truncate system-xs-regular text-text-tertiary">{payload.description}</div>
    </div>
  )
}

export default memo(Item)
