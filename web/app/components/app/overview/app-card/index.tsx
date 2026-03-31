'use client'
import type { IAppCardProps } from './types'
import AccessControl from '../../app-access-control'
import CustomizeModal from '../customize'
import EmbeddedModal from '../embedded'
import SettingsModal from '../settings'
import { AppCardAccessSection, AppCardAddressSection, AppCardDisabledOverlay, AppCardHeader, AppCardOperations } from './sections'
import { useAppCard } from './use-app-card'

function AppCard({
  appInfo,
  isInPanel,
  cardType = 'webapp',
  customBgColor,
  triggerModeDisabled = false,
  triggerModeMessage = '',
  onChangeStatus,
  onSaveSiteConfig,
  onGenerateCode,
  className,
}: IAppCardProps) {
  const {
    accessDisplay,
    accessToken,
    activeModal,
    addressLabel,
    apiUrl,
    appBaseUrl,
    appDetail,
    appMode,
    appUnpublished,
    appUrl,
    basicDescription,
    basicName,
    genLoading,
    handleAccessControlUpdate,
    handleClickAccessControl,
    handleGenerateCode,
    handleOperationSelect,
    isApp,
    isAppAccessSet,
    isCurrentWorkspaceManager,
    isMinimalState,
    learnMoreUrl,
    missingStartNode,
    operations,
    runningStatus,
    setActiveModal,
    setShowAccessControl,
    setShowConfirmDelete,
    showAccessControl,
    showConfirmDelete,
    systemFeatures,
    toggleDisabled,
  } = useAppCard({
    appInfo,
    cardType,
    onGenerateCode,
    triggerModeDisabled,
  })

  return (
    <div
      className={
        `${isInPanel ? 'border-l-[0.5px] border-t' : 'border-[0.5px] shadow-xs'} w-full max-w-full rounded-xl border-effects-highlight ${className ?? ''} ${isMinimalState ? 'h-12' : ''}`
      }
    >
      <div className={`${customBgColor ?? 'bg-background-default'} relative rounded-xl ${triggerModeDisabled ? 'opacity-60' : ''}`}>
        <AppCardDisabledOverlay triggerModeDisabled={triggerModeDisabled} triggerModeMessage={triggerModeMessage} />
        <div className={`flex w-full flex-col items-start justify-center gap-3 self-stretch p-3 ${isMinimalState ? 'border-0' : 'border-b-[0.5px] border-divider-subtle'}`}>
          <AppCardHeader
            appInfo={appInfo}
            basicDescription={basicDescription}
            basicName={basicName}
            cardType={cardType}
            learnMoreUrl={learnMoreUrl}
            runningStatus={runningStatus}
            toggleDisabled={toggleDisabled}
            triggerModeDisabled={triggerModeDisabled}
            triggerModeMessage={triggerModeMessage}
            appUnpublished={appUnpublished}
            missingStartNode={missingStartNode}
            onChangeStatus={onChangeStatus}
          />
          {!isMinimalState && (
            <AppCardAddressSection
              addressLabel={addressLabel}
              apiUrl={apiUrl}
              appUrl={appUrl}
              genLoading={genLoading}
              isApp={isApp}
              isCurrentWorkspaceManager={isCurrentWorkspaceManager}
              isRegenerateDialogOpen={showConfirmDelete}
              onCloseRegenerateDialog={() => setShowConfirmDelete(false)}
              onConfirmRegenerate={handleGenerateCode}
              onOpenRegenerateDialog={() => setShowConfirmDelete(true)}
            />
          )}
          {!isMinimalState && isApp && systemFeatures.webapp_auth.enabled && appDetail && accessDisplay && (
            <AppCardAccessSection
              iconClassName={accessDisplay.iconClassName}
              isAppAccessSet={isAppAccessSet}
              label={accessDisplay.label}
              onClick={handleClickAccessControl}
            />
          )}
        </div>
        {!isMinimalState && (
          <AppCardOperations
            appId={appInfo.id}
            isApp={isApp}
            operations={operations}
            onOperationSelect={handleOperationSelect}
          />
        )}
      </div>
      {isApp
        ? (
            <>
              <SettingsModal
                isChat={appMode === 'chat'}
                appInfo={appInfo}
                isShow={activeModal === 'settings'}
                onClose={() => setActiveModal(null)}
                onSave={onSaveSiteConfig}
              />
              <EmbeddedModal
                siteInfo={appInfo.site}
                isShow={activeModal === 'embedded'}
                onClose={() => setActiveModal(null)}
                appBaseUrl={appBaseUrl}
                accessToken={accessToken}
              />
              <CustomizeModal
                isShow={activeModal === 'customize'}
                onClose={() => setActiveModal(null)}
                appId={appInfo.id}
                api_base_url={appInfo.api_base_url}
                mode={appInfo.mode}
              />
              {
                showAccessControl && (
                  <AccessControl
                    app={appDetail!}
                    onConfirm={handleAccessControlUpdate}
                    onClose={() => { setShowAccessControl(false) }}
                  />
                )
              }
            </>
          )
        : null}
    </div>
  )
}

export default AppCard
