import type { EmbeddedMarketplaceCategory } from './category-marketplace'
import { Trans, useTranslation } from 'react-i18next'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { getCategoryMarketplaceId } from './category-marketplace'

const categoryConfig = {
  trigger: {
    categoryKey: 'category.triggers',
    iconClassName: 'i-custom-vender-integrations-trigger-active',
    textKey: 'list.noTriggerFound',
    tourTarget: STEP_BY_STEP_TOUR_TARGETS.integrationTriggerGrid,
  },
  'agent-strategy': {
    categoryKey: 'category.agents',
    iconClassName: 'i-custom-vender-integrations-agent-strategy-active',
    textKey: 'list.noAgentStrategyFound',
    tourTarget: STEP_BY_STEP_TOUR_TARGETS.integrationAgentStrategyEmpty,
  },
  extension: {
    categoryKey: 'category.extensions',
    iconClassName: 'i-custom-vender-integrations-extension-active',
    textKey: 'list.noExtensionFound',
    tourTarget: STEP_BY_STEP_TOUR_TARGETS.integrationExtensionGrid,
  },
} as const

type Category = keyof typeof categoryConfig

const CategoryEmptyState = ({
  category,
  showMarketplaceLink,
}: {
  category: EmbeddedMarketplaceCategory
  showMarketplaceLink: boolean
}) => {
  const { t } = useTranslation()
  const config = categoryConfig[category as Category]

  if (!config) return null

  return (
    <div
      className="mb-2 rounded-[10px] bg-workflow-process-bg p-4"
      data-step-by-step-tour-target={config.tourTarget}
    >
      <div className="flex size-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-sm">
        <span aria-hidden className={`${config.iconClassName} size-5 text-text-primary`} />
      </div>
      <div className="mt-2 system-sm-medium text-text-secondary">
        {t(($) => $[config.textKey], { ns: 'plugin' })}
      </div>
      {showMarketplaceLink && (
        <p className="mt-1 system-xs-regular text-text-tertiary">
          <Trans
            components={{
              marketplace: (
                <a
                  aria-label={t(($) => $['marketplace.difyMarketplace'], { ns: 'plugin' })}
                  className="system-xs-medium text-text-accent hover:underline"
                  href={`#${getCategoryMarketplaceId(category)}`}
                >
                  {t(($) => $['marketplace.difyMarketplace'], { ns: 'plugin' })}
                </a>
              ),
            }}
            i18nKey={($) => $['list.emptyInstallFromMarketplace']}
            ns="plugin"
            values={{ category: t(($) => $[config.categoryKey], { ns: 'plugin' }) }}
          />
        </p>
      )}
    </div>
  )
}

export default CategoryEmptyState
