import {
  memo,
  useCallback,
} from 'react'
import { useStore } from './store'
import {
  useIsChatMode,
  useNodesReadOnly,
  useNodesSyncDraft,
} from './hooks'
import NewFeaturePanel from '@/app/components/base/features/new-feature-panel'

const Features = () => {
  const setShowFeaturesPanel = useStore(s => s.setShowFeaturesPanel)
  const isChatMode = useIsChatMode()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleFeaturesChange = useCallback(() => {
    handleSyncWorkflowDraft()
  }, [handleSyncWorkflowDraft])

  return (
    <NewFeaturePanel
      show
      isChatMode={isChatMode}
      disabled={nodesReadOnly}
      onChange={handleFeaturesChange}
      onClose={() => setShowFeaturesPanel(false)}
    />
    // <div className='fixed top-16 left-2 bottom-2 w-[600px] rounded-2xl border-[0.5px] border-gray-200 bg-white shadow-xl z-10'>
    //   <div className='flex items-center justify-between px-4 pt-3'>
    //     {t('workflow.common.features')}
    //     <div className='flex items-center'>
    //       {
    //         isChatMode && (
    //           <>
    //             <FeaturesChoose
    //               disabled={nodesReadOnly}
    //               onChange={handleFeaturesChange}
    //             />
    //             <div className='mx-3 w-[1px] h-[14px] bg-gray-200'></div>
    //           </>
    //         )
    //       }
    //       <div
    //         className='flex items-center justify-center w-6 h-6 cursor-pointer'
    //         onClick={() => setShowFeaturesPanel(false)}
    //       >
    //         <RiCloseLine className='w-4 h-4 text-gray-500' />
    //       </div>
    //     </div>
    //   </div>
    //   <div className='p-4'>
    //     <FeaturesPanel
    //       disabled={nodesReadOnly}
    //       onChange={handleFeaturesChange}
    //       openingStatementProps={{
    //         onAutoAddPromptVariable: () => {},
    //       }}
    //     />
    //   </div>
    // </div>
  )
}

export default memo(Features)
