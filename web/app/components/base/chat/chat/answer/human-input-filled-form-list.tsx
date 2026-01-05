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
    <div className="mt-2">
      {
        humanInputFilledFormDataList.map(formData => (
          <ContentWrapper
            key={formData.node_id}
            nodeTitle="todo: replace with node title"
            showExpandIcon
            className="mb-2 last:mb-0"
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
