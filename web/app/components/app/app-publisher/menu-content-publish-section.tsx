import type { FC } from 'react'
import type { AppPublisherMenuContentProps } from './menu-content.types'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import ShortcutsName from '../../workflow/shortcuts-name'
import { PUBLISH_SHORTCUT } from './menu-content.utils'
import PublishWithMultipleModel from './publish-with-multiple-model'

type MenuContentPublishSectionProps = Pick<
  AppPublisherMenuContentProps,
  | 'debugWithMultipleModel'
  | 'draftUpdatedAt'
  | 'formatTimeFromNow'
  | 'isChatApp'
  | 'multipleModelConfigs'
  | 'onPublish'
  | 'onRestore'
  | 'publishDisabled'
  | 'published'
  | 'publishedAt'
  | 'publishLoading'
  | 'startNodeLimitExceeded'
  | 'upgradeHighlightStyle'
>

const MenuContentPublishSection: FC<MenuContentPublishSectionProps> = ({
  debugWithMultipleModel = false,
  draftUpdatedAt,
  formatTimeFromNow,
  isChatApp,
  multipleModelConfigs = [],
  onPublish,
  onRestore,
  publishDisabled = false,
  published,
  publishedAt,
  publishLoading = false,
  startNodeLimitExceeded = false,
  upgradeHighlightStyle,
}) => {
  const { t } = useTranslation()

  return (
    <div className="p-4 pt-3">
      <div className="flex h-6 items-center text-text-tertiary system-xs-medium-uppercase">
        {publishedAt
          ? t('common.latestPublished', { ns: 'workflow' })
          : t('common.currentDraftUnpublished', { ns: 'workflow' })}
      </div>
      {publishedAt
        ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center text-text-secondary system-sm-medium">
                {t('common.publishedAt', { ns: 'workflow' })}
                {' '}
                {formatTimeFromNow(publishedAt)}
              </div>
              {isChatApp && (
                <Button
                  variant="secondary-accent"
                  size="small"
                  onClick={onRestore}
                  disabled={published}
                >
                  {t('common.restore', { ns: 'workflow' })}
                </Button>
              )}
            </div>
          )
        : (
            <div className="flex items-center text-text-secondary system-sm-medium">
              {t('common.autoSaved', { ns: 'workflow' })}
              {' '}
              ·
              {Boolean(draftUpdatedAt) && formatTimeFromNow(draftUpdatedAt!)}
            </div>
          )}
      {debugWithMultipleModel
        ? (
            <PublishWithMultipleModel
              multipleModelConfigs={multipleModelConfigs}
              onSelect={item => onPublish(item)}
            />
          )
        : (
            <>
              <Button
                variant="primary"
                className="mt-3 w-full"
                onClick={() => onPublish()}
                disabled={publishDisabled || published || publishLoading}
                loading={publishLoading}
              >
                {publishLoading
                  ? t('common.publishing', { ns: 'workflow' })
                  : published
                    ? t('common.published', { ns: 'workflow' })
                    : (
                        <div className="flex gap-1">
                          <span>{t('common.publishUpdate', { ns: 'workflow' })}</span>
                          <ShortcutsName keys={PUBLISH_SHORTCUT} bgColor="white" />
                        </div>
                      )}
              </Button>
              {startNodeLimitExceeded && (
                <div className="mt-3 flex flex-col items-stretch">
                  <p
                    className="text-sm font-semibold leading-5 text-transparent"
                    style={upgradeHighlightStyle}
                  >
                    <span className="block">{t('publishLimit.startNodeTitlePrefix', { ns: 'workflow' })}</span>
                    <span className="block">{t('publishLimit.startNodeTitleSuffix', { ns: 'workflow' })}</span>
                  </p>
                  <p className="mt-1 text-xs leading-4 text-text-secondary">
                    {t('publishLimit.startNodeDesc', { ns: 'workflow' })}
                  </p>
                  <UpgradeBtn
                    isShort
                    className="mb-[12px] mt-[9px] h-[32px] w-[93px] self-start"
                  />
                </div>
              )}
            </>
          )}
    </div>
  )
}

export default MenuContentPublishSection
