'use client'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { useDebounceFn, useKeyPress } from 'ahooks'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import { ToastContext } from '@/app/components/base/toast'
import {
  DSLImportMode,
  DSLImportStatus,
} from '@/models/app'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { noop } from 'lodash-es'
import Uploader from './uploader'
import Header from './header'
import Tab from './tab'
import { useImportPipelineDSL, useImportPipelineDSLConfirm } from '@/service/use-pipeline'

type CreateFromDSLModalProps = {
  show: boolean
  onSuccess?: () => void
  onClose: () => void
  activeTab?: CreateFromDSLModalTab
  dslUrl?: string
}

export enum CreateFromDSLModalTab {
  FROM_FILE = 'from-file',
  FROM_URL = 'from-url',
}

const CreateFromDSLModal = ({
  show,
  onSuccess,
  onClose,
  activeTab = CreateFromDSLModalTab.FROM_FILE,
  dslUrl = '',
}: CreateFromDSLModalProps) => {
  const { push } = useRouter()
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const [currentFile, setDSLFile] = useState<File>()
  const [fileContent, setFileContent] = useState<string>()
  const [currentTab, setCurrentTab] = useState(activeTab)
  const [dslUrlValue, setDslUrlValue] = useState(dslUrl)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [versions, setVersions] = useState<{ importedVersion: string; systemVersion: string }>()
  const [importId, setImportId] = useState<string>()
  const { handleCheckPluginDependencies } = usePluginDependencies()

  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = function (event) {
      const content = event.target?.result
      setFileContent(content as string)
    }
    reader.readAsText(file)
  }

  const handleFile = (file?: File) => {
    setDSLFile(file)
    if (file)
      readFile(file)
    if (!file)
      setFileContent('')
  }

  const isCreatingRef = useRef(false)

  const { mutateAsync: importDSL } = useImportPipelineDSL()

  const onCreate = async () => {
    if (currentTab === CreateFromDSLModalTab.FROM_FILE && !currentFile)
      return
    if (currentTab === CreateFromDSLModalTab.FROM_URL && !dslUrlValue)
      return
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    let response
    if (currentTab === CreateFromDSLModalTab.FROM_FILE) {
      response = await importDSL({
        mode: DSLImportMode.YAML_CONTENT,
        yaml_content: fileContent || '',
      })
    }
    if (currentTab === CreateFromDSLModalTab.FROM_URL) {
      response = await importDSL({
        mode: DSLImportMode.YAML_URL,
        yaml_url: dslUrlValue || '',
      })
    }

    if (!response) {
      notify({ type: 'error', message: t('datasetPipeline.creation.errorTip') })
      isCreatingRef.current = false
      return
    }
    const { id, status, pipeline_id, dataset_id, imported_dsl_version, current_dsl_version } = response
    if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
      if (onSuccess)
        onSuccess()
      if (onClose)
        onClose()

      notify({
        type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
        message: t(status === DSLImportStatus.COMPLETED ? 'datasetPipeline.creation.successTip' : 'datasetPipeline.creation.caution'),
        children: status === DSLImportStatus.COMPLETED_WITH_WARNINGS && t('app.newApp.appCreateDSLWarning'),
      })
      if (pipeline_id)
        await handleCheckPluginDependencies(pipeline_id, true)
      push(`/datasets/${dataset_id}/pipeline`)
      isCreatingRef.current = false
    }
    else if (status === DSLImportStatus.PENDING) {
      setVersions({
        importedVersion: imported_dsl_version ?? '',
        systemVersion: current_dsl_version ?? '',
      })
      if (onClose)
        onClose()
      setTimeout(() => {
        setShowErrorModal(true)
      }, 300)
      setImportId(id)
      isCreatingRef.current = false
    }
    else {
      notify({ type: 'error', message: t('datasetPipeline.creation.errorTip') })
      isCreatingRef.current = false
    }
  }

  const { run: handleCreateApp } = useDebounceFn(onCreate, { wait: 300 })

  useKeyPress('esc', () => {
    if (show && !showErrorModal)
      onClose()
  })

  const { mutateAsync: importDSLConfirm } = useImportPipelineDSLConfirm()

  const onDSLConfirm = async () => {
    if (!importId)
      return
    const response = await importDSLConfirm(importId)

    if (!response) {
      notify({ type: 'error', message: t('datasetPipeline.creation.errorTip') })
      return
    }

    const { status, pipeline_id, dataset_id } = response

    if (status === DSLImportStatus.COMPLETED) {
      if (onSuccess)
        onSuccess()
      if (onClose)
        onClose()

      notify({
        type: 'success',
        message: t('datasetPipeline.creation.successTip'),
      })
      if (pipeline_id)
        await handleCheckPluginDependencies(pipeline_id, true)
      push(`datasets/${dataset_id}/pipeline`)
    }
    else if (status === DSLImportStatus.FAILED) {
      notify({ type: 'error', message: t('datasetPipeline.creation.errorTip') })
    }
  }

  const buttonDisabled = useMemo(() => {
    if (currentTab === CreateFromDSLModalTab.FROM_FILE)
      return !currentFile
    if (currentTab === CreateFromDSLModalTab.FROM_URL)
      return !dslUrlValue
    return false
  }, [currentTab, currentFile, dslUrlValue])

  return (
    <>
      <Modal
        className='w-[520px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0 shadow-xl'
        isShow={show}
        onClose={noop}
      >
        <Header onClose={onClose} />
        <Tab
          currentTab={currentTab}
          setCurrentTab={setCurrentTab}
        />
        <div className='px-6 py-4'>
          {
            currentTab === CreateFromDSLModalTab.FROM_FILE && (
              <Uploader
                className='mt-0'
                file={currentFile}
                updateFile={handleFile}
              />
            )
          }
          {
            currentTab === CreateFromDSLModalTab.FROM_URL && (
              <div>
                <div className='system-md-semibold leading6 mb-1 text-text-secondary'>
                  DSL URL
                </div>
                <Input
                  placeholder={t('app.importFromDSLUrlPlaceholder') || ''}
                  value={dslUrlValue}
                  onChange={e => setDslUrlValue(e.target.value)}
                />
              </div>
            )
          }
        </div>
        <div className='flex justify-end gap-x-2 p-6 pt-5'>
          <Button onClick={onClose}>
            {t('app.newApp.Cancel')}
          </Button>
          <Button
            disabled={buttonDisabled}
            variant='primary'
            onClick={handleCreateApp}
            className='gap-1'
          >
            <span>{t('app.newApp.import')}</span>
          </Button>
        </div>
      </Modal>
      <Modal
        isShow={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        className='w-[480px]'
      >
        <div className='flex flex-col items-start gap-2 self-stretch pb-4'>
          <div className='title-2xl-semi-bold text-text-primary'>{t('app.newApp.appCreateDSLErrorTitle')}</div>
          <div className='system-md-regular flex grow flex-col text-text-secondary'>
            <div>{t('app.newApp.appCreateDSLErrorPart1')}</div>
            <div>{t('app.newApp.appCreateDSLErrorPart2')}</div>
            <br />
            <div>{t('app.newApp.appCreateDSLErrorPart3')}<span className='system-md-medium'>{versions?.importedVersion}</span></div>
            <div>{t('app.newApp.appCreateDSLErrorPart4')}<span className='system-md-medium'>{versions?.systemVersion}</span></div>
          </div>
        </div>
        <div className='flex items-start justify-end gap-2 self-stretch pt-6'>
          <Button variant='secondary' onClick={() => setShowErrorModal(false)}>{t('app.newApp.Cancel')}</Button>
          <Button variant='primary' destructive onClick={onDSLConfirm}>{t('app.newApp.Confirm')}</Button>
        </div>
      </Modal>
    </>
  )
}

export default CreateFromDSLModal
