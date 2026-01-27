'use client'
import type { FC } from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import { BoxGroup } from '@/app/components/workflow/nodes/_base/components/layout'
import { cn } from '@/utils/classnames'
import ReferenceToolConfig from './reference-tool-config'

const i18nPrefix = 'nodes.llm.computerUse'

type Props = {
  readonly: boolean
  enabled: boolean
  onChange: (enabled: boolean) => void
}

const ComputerUseConfig: FC<Props> = ({
  readonly,
  enabled,
  onChange,
}) => {
  const { t } = useTranslation()
  const [isCollapsed, { toggle: toggleCollapsed }] = useBoolean(false)

  return (
    <BoxGroup
      boxProps={{
        withBorderBottom: true,
        withBorderTop: true,
        className: 'py-0',
      }}
      groupProps={{
        className: 'px-0 py-0',
      }}
    >
      <div className="pb-2 pt-1">
        <div className="flex items-center pb-1 pt-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <div className="system-sm-semibold-uppercase text-text-secondary">
              {t(`${i18nPrefix}.title`, { ns: 'workflow' })}
            </div>
            <Tooltip
              popupContent={t(`${i18nPrefix}.tooltip`, { ns: 'workflow' })}
              triggerClassName="h-4 w-4"
            />
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-state-base-hover"
            >
              <RiArrowDownSLine
                className={cn('h-4 w-4 transition-transform', isCollapsed && '-rotate-90')}
              />
            </button>
          </div>
          <Switch
            size="md"
            disabled={readonly}
            defaultValue={enabled}
            onChange={onChange}
          />
        </div>
        {!isCollapsed && (
          <div className="flex flex-col gap-2 pb-2">
            <div className="system-xs-medium text-text-tertiary">
              {t(`${i18nPrefix}.referenceTools`, { ns: 'workflow' })}
            </div>
            <ReferenceToolConfig readonly={readonly} enabled={enabled} />
          </div>
        )}
      </div>
    </BoxGroup>
  )
}

export default React.memo(ComputerUseConfig)
