'use client'
import type { FC } from 'react'
import type { Plugin, PluginDeclaration, PluginManifestInMarket } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import * as React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import Link from '@/next/link'
import Card from '../../card'
import { PluginCategoryEnum } from '../../types'
import { pluginManifestInMarketToPluginProps, pluginManifestToCardPluginProps } from '../utils'

type Props = Readonly<{
  payload?: Plugin | PluginDeclaration | PluginManifestInMarket | null
  isMarketPayload?: boolean
  isFailed: boolean
  errMsg?: string | null
  installContextCategory?: PluginCategoryEnum
  onCancel: () => void
}>

type CategoryTarget = {
  labelKey: 'menus.tools' | 'settings.agentStrategy' | 'settings.dataSource' | 'settings.extension' | 'settings.provider' | 'settings.trigger'
  path: string
}

const categoryTargetMap: Partial<Record<PluginCategoryEnum, CategoryTarget>> = {
  [PluginCategoryEnum.model]: {
    labelKey: 'settings.provider',
    path: buildIntegrationPath('provider'),
  },
  [PluginCategoryEnum.tool]: {
    labelKey: 'menus.tools',
    path: buildIntegrationPath('builtin'),
  },
  [PluginCategoryEnum.datasource]: {
    labelKey: 'settings.dataSource',
    path: buildIntegrationPath('data-source'),
  },
  [PluginCategoryEnum.trigger]: {
    labelKey: 'settings.trigger',
    path: buildIntegrationPath('trigger'),
  },
  [PluginCategoryEnum.agent]: {
    labelKey: 'settings.agentStrategy',
    path: buildIntegrationPath('agent-strategy'),
  },
  [PluginCategoryEnum.extension]: {
    labelKey: 'settings.extension',
    path: buildIntegrationPath('extension'),
  },
}

const Installed: FC<Props> = ({
  payload,
  isMarketPayload,
  isFailed,
  errMsg,
  installContextCategory,
  onCancel,
}) => {
  const { t } = useTranslation('plugin')
  const installedCategory = payload?.category
  const categoryTarget = !isFailed && installContextCategory && installedCategory !== installContextCategory
    ? categoryTargetMap[installedCategory as PluginCategoryEnum]
    : undefined
  const categoryName = categoryTarget ? t($ => $[categoryTarget.labelKey], { ns: 'common' }) : ''

  const handleClose = () => {
    onCancel()
  }
  return (
    <>
      <div className="flex flex-col items-start justify-center gap-2 self-stretch px-6 py-3">
        <p className="system-md-regular text-text-secondary">
          {(isFailed && errMsg)
            ? errMsg
            : categoryTarget
              ? (
                  <Trans
                    t={t}
                    i18nKey={$ => $["installModal.installedSuccessfullyWithPageDesc"]}
                    ns="plugin"
                    components={{
                      categoryName: <span className="system-sm-semibold text-text-secondary" />,
                    }}
                    values={{ categoryName }}
                  />
                )
              : t($ => $[`installModal.${isFailed ? 'installFailedDesc' : 'installedSuccessfullyDesc'}`], { ns: 'plugin' })}
        </p>
        {payload && (
          <div className="flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl bg-background-section-burn p-2">
            <Card
              className="w-full"
              payload={isMarketPayload ? pluginManifestInMarketToPluginProps(payload as PluginManifestInMarket) : pluginManifestToCardPluginProps(payload as PluginDeclaration)}
              installed={!isFailed}
              installFailed={isFailed}
              titleLeft={<Badge className="mx-1" size="s" state={BadgeState.Default}>{(payload as PluginDeclaration).version || (payload as PluginManifestInMarket).latest_version}</Badge>}
              compact
            />
          </div>
        )}
      </div>
      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-2 self-stretch p-6 pt-5">
        <Button
          variant="primary"
          className="min-w-[72px]"
          render={categoryTarget ? <Link href={categoryTarget.path} /> : undefined}
          onClick={handleClose}
        >
          {categoryTarget
            ? (
                <>
                  <span>{t($ => $['installModal.viewDetails'], { ns: 'plugin' })}</span>
                  <span className="i-ri-arrow-right-up-line size-4 shrink-0" aria-hidden="true" />
                </>
              )
            : t($ => $['operation.close'], { ns: 'common' })}
        </Button>
      </div>
    </>
  )
}
export default React.memo(Installed)
