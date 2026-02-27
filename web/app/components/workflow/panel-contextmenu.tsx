import { useClickAway } from 'ahooks'
import {
  memo,
  useEffect,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import Divider from '../base/divider'
import {
  useDSL,
  useNodesInteractions,
  usePanelInteractions,
  useWorkflowStartRun,
} from './hooks'
import AddBlock from './operator/add-block'
import { useOperator } from './operator/hooks'
import ShortcutsName from './shortcuts-name'
import { useStore } from './store'

const PanelContextmenu = () => {
  const { t } = useTranslation()
  const ref = useRef(null)
  const panelMenu = useStore(s => s.panelMenu)
  const clipboardElements = useStore(s => s.clipboardElements)
  const setShowImportDSLModal = useStore(s => s.setShowImportDSLModal)
  const { handleNodesPaste } = useNodesInteractions()
  const { handlePaneContextmenuCancel, handleNodeContextmenuCancel } = usePanelInteractions()
  const { handleStartWorkflowRun } = useWorkflowStartRun()
  const { handleAddNote } = useOperator()
  const { exportCheck } = useDSL()

  useEffect(() => {
    if (panelMenu)
      handleNodeContextmenuCancel()
  }, [panelMenu, handleNodeContextmenuCancel])

  useClickAway(() => {
    handlePaneContextmenuCancel()
  }, ref)

  const renderTrigger = () => {
    return (
      <div
        className="flex h-8 cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover"
      >
        {t('common.addBlock', { ns: 'workflow' })}
      </div>
    )
  }

  if (!panelMenu)
    return null

  return (
    <div
      className="absolute z-[9] w-[200px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg"
      style={{
        left: panelMenu.left,
        top: panelMenu.top,
      }}
      ref={ref}
    >
      <div className="p-1">
        <AddBlock
          renderTrigger={renderTrigger}
          offset={{
            mainAxis: -36,
            crossAxis: -4,
          }}
        />
        <div
          className="flex h-8 cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover"
          onClick={(e) => {
            e.stopPropagation()
            handleAddNote()
            handlePaneContextmenuCancel()
          }}
        >
          {t('nodes.note.addNote', { ns: 'workflow' })}
        </div>
        <div
          className="flex h-8 cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover"
          onClick={() => {
            handleStartWorkflowRun()
            handlePaneContextmenuCancel()
          }}
        >
          {t('common.run', { ns: 'workflow' })}
          <ShortcutsName keys={['alt', 'r']} />
        </div>
      </div>
      <Divider className="m-0" />
      <div className="p-1">
        <div
          className={cn(
            'flex h-8 cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary',
            !clipboardElements.length ? 'cursor-not-allowed opacity-50' : 'hover:bg-state-base-hover',
          )}
          onClick={() => {
            if (clipboardElements.length) {
              handleNodesPaste()
              handlePaneContextmenuCancel()
            }
          }}
        >
          {t('common.pasteHere', { ns: 'workflow' })}
          <ShortcutsName keys={['ctrl', 'v']} />
        </div>
      </div>
      <Divider className="m-0" />
      <div className="p-1">
        <div
          className="flex h-8 cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover"
          onClick={() => exportCheck?.()}
        >
          {t('export', { ns: 'app' })}
        </div>
        <div
          className="flex h-8 cursor-pointer items-center justify-between rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover"
          onClick={() => setShowImportDSLModal(true)}
        >
          {t('common.importDSL', { ns: 'workflow' })}
        </div>
      </div>
    </div>
  )
}

export default memo(PanelContextmenu)
