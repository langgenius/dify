import type { HumanInputFilledFormData } from '@/types/workflow'
import ContentWrapper from '@/app/components/base/chat/chat/answer/human-input-content/content-wrapper'
import { SubmittedHumanInputContent } from '@/app/components/base/chat/chat/answer/human-input-content/submitted'

type HumanInputFilledFormListProps = {
  humanInputFilledFormDataList: HumanInputFilledFormData[]
}

const HumanInputFilledFormList = ({
  humanInputFilledFormDataList,
}: HumanInputFilledFormListProps) => {
  return (
    <div className="mt-3 flex flex-col gap-y-3 first:mt-0">
      {
        humanInputFilledFormDataList.map(formData => (
          <ContentWrapper
            key={formData.node_id}
            nodeTitle={formData.node_title}
            showExpandIcon
            className="bg-components-panel-bg"
            expanded
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
