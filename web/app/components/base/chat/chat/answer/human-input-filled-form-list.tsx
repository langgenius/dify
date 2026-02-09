import type { HumanInputFilledFormData } from '@/types/workflow'
import ContentWrapper from './human-input-content/content-wrapper'
import { SubmittedHumanInputContent } from './human-input-content/submitted'

type HumanInputFilledFormListProps = {
  humanInputFilledFormDataList: HumanInputFilledFormData[]
}

const HumanInputFilledFormList = ({
  humanInputFilledFormDataList,
}: HumanInputFilledFormListProps) => {
  return (
    <div className="mt-2 flex flex-col gap-y-2">
      {
        humanInputFilledFormDataList.map(formData => (
          <ContentWrapper
            key={formData.node_id}
            nodeTitle={formData.node_title}
            showExpandIcon
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
