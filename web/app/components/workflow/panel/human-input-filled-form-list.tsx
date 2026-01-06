import type { HumanInputFilledFormData } from '@/types/workflow'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import ContentWrapper from '@/app/components/base/chat/chat/answer/human-input-content/content-wrapper'
import { SubmittedHumanInputContent } from '@/app/components/base/chat/chat/answer/human-input-content/submitted'
import { CUSTOM_NODE } from '@/app/components/workflow/constants'

type HumanInputFilledFormListProps = {
  humanInputFilledFormDataList: HumanInputFilledFormData[]
}

const HumanInputFilledFormList = ({
  humanInputFilledFormDataList,
}: HumanInputFilledFormListProps) => {
  const store = useStoreApi()

  const getHumanInputNodeTitle = useCallback((nodeID: string) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes().filter(node => node.type === CUSTOM_NODE)
    const node = nodes.find(n => n.id === nodeID)
    return node?.data.title
  }, [store])

  return (
    <div className="mt-3 flex flex-col gap-y-3 first:mt-0">
      {
        humanInputFilledFormDataList.map(formData => (
          <ContentWrapper
            key={formData.node_id}
            nodeTitle={getHumanInputNodeTitle(formData.node_id)}
            showExpandIcon
            className="bg-components-panel-bg"
          >
            <SubmittedHumanInputContent
              key={formData.node_id}
              formData={formData}
            />
          </ContentWrapper>
        ))
      }
    </div>
  )
}

export default HumanInputFilledFormList
