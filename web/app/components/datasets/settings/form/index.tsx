'use client'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import BasicInfoSection from './components/basic-info-section'
import ExternalKnowledgeSection from './components/external-knowledge-section'
import IndexingSection from './components/indexing-section'
import { useFormState } from './hooks/use-form-state'

const Form = () => {
  const { t } = useTranslation()
  const {
    // Context values
    currentDataset,
    canEditSettings,

    // Loading state
    loading,

    // Basic form
    name,
    setName,
    description,
    setDescription,

    // Icon
    iconInfo,
    showAppIconPicker,
    setShowAppIconPicker,
    handleOpenAppIconPicker,
    handleSelectAppIcon,

    // Permission
    permission,
    setPermission,
    selectedMemberIDs,
    setSelectedMemberIDs,
    memberList,

    // External retrieval
    externalKnowledgeId,
    setExternalKnowledgeId,
    topK,
    scoreThreshold,
    scoreThresholdEnabled,
    handleSettingsChange,

    // Indexing and retrieval
    indexMethod,
    setIndexMethod,
    keywordNumber,
    setKeywordNumber,
    retrievalConfig,
    setRetrievalConfig,
    embeddingModel,
    setEmbeddingModel,
    embeddingModelList,

    // Summary index
    summaryIndexSetting,
    handleSummaryIndexSettingChange,

    // Computed
    showMultiModalTip,

    // Actions
    handleSave,
  } = useFormState()

  const isExternalProvider = currentDataset?.provider === 'external'
  const readonly = !canEditSettings

  return (
    <div className="flex w-full flex-col gap-y-4 px-20 py-8 sm:w-[960px]">
      <BasicInfoSection
        currentDataset={currentDataset}
        name={name}
        setName={setName}
        description={description}
        setDescription={setDescription}
        iconInfo={iconInfo}
        showAppIconPicker={showAppIconPicker}
        setShowAppIconPicker={setShowAppIconPicker}
        handleOpenAppIconPicker={handleOpenAppIconPicker}
        handleSelectAppIcon={handleSelectAppIcon}
        permission={permission}
        setPermission={setPermission}
        selectedMemberIDs={selectedMemberIDs}
        setSelectedMemberIDs={setSelectedMemberIDs}
        memberList={memberList}
        readonly={readonly}
      />

      {isExternalProvider
        ? (
            <ExternalKnowledgeSection
              currentDataset={currentDataset}
              externalKnowledgeId={externalKnowledgeId}
              setExternalKnowledgeId={setExternalKnowledgeId}
              topK={topK}
              scoreThreshold={scoreThreshold}
              scoreThresholdEnabled={scoreThresholdEnabled}
              handleSettingsChange={handleSettingsChange}
              readonly={readonly}
            />
          )
        : (
            <IndexingSection
              currentDataset={currentDataset}
              indexMethod={indexMethod}
              setIndexMethod={setIndexMethod}
              keywordNumber={keywordNumber}
              setKeywordNumber={setKeywordNumber}
              embeddingModel={embeddingModel}
              setEmbeddingModel={setEmbeddingModel}
              embeddingModelList={embeddingModelList}
              retrievalConfig={retrievalConfig}
              setRetrievalConfig={setRetrievalConfig}
              summaryIndexSetting={summaryIndexSetting}
              handleSummaryIndexSettingChange={handleSummaryIndexSettingChange}
              showMultiModalTip={showMultiModalTip}
              readonly={readonly}
            />
          )}

      <Divider type="horizontal" className="my-1 h-px bg-divider-subtle" />

      {/* Save Button */}
      <div className="flex gap-x-1">
        <div className="flex h-7 w-[180px] shrink-0 items-center pt-1" />
        <div className="grow">
          <Button
            className="min-w-24"
            variant="primary"
            loading={loading}
            disabled={loading || readonly}
            onClick={handleSave}
          >
            {t('form.save', { ns: 'datasetSettings' })}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default Form
