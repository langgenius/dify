'use client'
import type { FC } from 'react'
import type { DataSet } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import {
  RiDeleteBinLine,
  RiEditLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SettingsModal from '@/app/components/app/configuration/dataset-config/settings-modal'
import ActionButton, { ActionButtonState } from '@/app/components/base/action-button'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import FeatureIcon from '@/app/components/header/account-setting/model-provider-page/model-selector/feature-icon'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useKnowledge } from '@/hooks/use-knowledge'

type Props = {
  payload: DataSet
  onRemove: () => void
  onChange: (dataSet: DataSet) => void
  readonly?: boolean
  editable?: boolean
}

const DatasetItem: FC<Props> = ({
  payload,
  onRemove,
  onChange,
  readonly,
  editable = true,
}) => {
  const media = useBreakpoints()
  const { t } = useTranslation()
  const isMobile = media === MediaType.mobile
  const { formatIndexingTechniqueAndMethod } = useKnowledge()
  const [isDeleteHovered, setIsDeleteHovered] = useState(false)

  const [isShowSettingsModal, {
    setTrue: showSettingsModal,
    setFalse: hideSettingsModal,
  }] = useBoolean(false)

  const handleSave = useCallback((newDataset: DataSet) => {
    onChange(newDataset)
    hideSettingsModal()
  }, [hideSettingsModal, onChange])

  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onRemove()
  }, [onRemove])

  const iconInfo = payload.icon_info || {
    icon: '📙',
    icon_type: 'emoji',
    icon_background: '#FFF4ED',
    icon_url: '',
  }

  return (
    <div className={`group/dataset-item flex h-10 cursor-pointer items-center justify-between rounded-lg
      border-[0.5px] border-components-panel-border-subtle px-2
      ${isDeleteHovered
      ? 'border-state-destructive-border bg-state-destructive-hover'
      : 'bg-components-panel-on-panel-item-bg hover:bg-components-panel-on-panel-item-bg-hover'
    }`}
    >
      <div className="flex w-0 grow items-center space-x-1.5">
        <AppIcon
          size="tiny"
          iconType={iconInfo.icon_type}
          icon={iconInfo.icon}
          background={iconInfo.icon_type === 'image' ? undefined : iconInfo.icon_background}
          imageUrl={iconInfo.icon_type === 'image' ? iconInfo.icon_url : undefined}
        />
        <div className="w-0 grow truncate system-sm-medium text-text-secondary">{payload.name}</div>
      </div>
      {!readonly && (
        <div className="ml-2 hidden shrink-0 items-center space-x-1 group-hover/dataset-item:flex">
          {
            editable && (
              <ActionButton
                aria-label={t('operation.edit', { ns: 'common' })}
                data-testid="dataset-item-edit-button"
                onClick={(e) => {
                  e.stopPropagation()
                  showSettingsModal()
                }}
              >
                <RiEditLine className="h-4 w-4 shrink-0 text-text-tertiary" />
              </ActionButton>
            )
          }
          <ActionButton
            aria-label={t('operation.remove', { ns: 'common' })}
            data-testid="dataset-item-remove-button"
            onClick={handleRemove}
            state={isDeleteHovered ? ActionButtonState.Destructive : ActionButtonState.Default}
            onMouseEnter={() => setIsDeleteHovered(true)}
            onMouseLeave={() => setIsDeleteHovered(false)}
          >
            <RiDeleteBinLine className={`h-4 w-4 shrink-0 ${isDeleteHovered ? 'text-text-destructive' : 'text-text-tertiary'}`} />
          </ActionButton>
        </div>
      )}
      {payload.is_multimodal && (
        <div className="mr-1 shrink-0 group-hover/dataset-item:hidden">
          <FeatureIcon feature={ModelFeatureEnum.vision} />
        </div>
      )}
      {
        !!payload.indexing_technique && (
          <Badge
            className="shrink-0 group-hover/dataset-item:hidden"
            text={formatIndexingTechniqueAndMethod(payload.indexing_technique, payload.retrieval_model_dict?.search_method)}
          />
        )
      }
      {
        payload.provider === 'external' && (
          <Badge
            className="shrink-0 group-hover/dataset-item:hidden"
            text={t('externalTag', { ns: 'dataset' })}
          />
        )
      }

      {isShowSettingsModal && (
        <Drawer
          open={isShowSettingsModal}
          modal
          swipeDirection="right"
          onOpenChange={(open) => {
            if (!open)
              hideSettingsModal()
          }}
        >
          <DrawerPortal>
            <DrawerBackdrop className={cn(!isMobile && 'bg-transparent')} />
            <DrawerViewport>
              <DrawerPopup className="p-0! data-[swipe-direction=right]:top-16 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-3 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-[640px] data-[swipe-direction=right]:rounded-xl">
                <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                  <SettingsModal
                    currentDataset={payload}
                    onCancel={hideSettingsModal}
                    onSave={handleSave}
                  />
                </DrawerContent>
              </DrawerPopup>
            </DrawerViewport>
          </DrawerPortal>
        </Drawer>
      )}
    </div>
  )
}
export default React.memo(DatasetItem)
