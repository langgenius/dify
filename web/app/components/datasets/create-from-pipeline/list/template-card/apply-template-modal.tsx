import Modal from '@/app/components/base/modal'
import CreateForm from '../../create-form'
import { useCallback, useEffect, useState } from 'react'
import type { CreateFormData } from '@/models/pipeline'
import { ChunkingMode, type CreateDatasetReq, DatasetPermission } from '@/models/datasets'
import { useCreatePipelineDataset } from '@/service/knowledge/use-create-dataset'
import type { Member } from '@/models/common'
import { useMembers } from '@/service/use-common'

type ApplyTemplateModalProps = {
  show: boolean
  onClose: () => void
}

const ApplyTemplateModal = ({
  show,
  onClose,
}: ApplyTemplateModalProps) => {
  const [memberList, setMemberList] = useState<Member[]>([])
  const { data: members } = useMembers()

  useEffect(() => {
    if (members?.accounts)
      setMemberList(members.accounts)
  }, [members])

  const { mutateAsync: createEmptyDataset } = useCreatePipelineDataset() // todo: yaml content

  const handleCreate = useCallback(async (payload: CreateFormData) => {
    const { name, appIcon, description, permission, selectedMemberIDs } = payload
    const request: CreateDatasetReq = {
      name,
      description,
      icon_info: {
        icon_type: appIcon.type,
        icon: appIcon.type === 'image' ? appIcon.fileId : appIcon.icon,
        icon_background: appIcon.type === 'image' ? undefined : appIcon.background,
        icon_url: appIcon.type === 'image' ? appIcon.url : undefined,
      },
      doc_form: ChunkingMode.text,
      permission,
    }
    // Handle permission
    if (request.permission === DatasetPermission.partialMembers) {
      const selectedMemberList = selectedMemberIDs.map((id) => {
        return {
          user_id: id,
          role: memberList.find(member => member.id === id)?.role,
        }
      })
      request.partial_member_list = selectedMemberList
    }
    await createEmptyDataset(request, {
      onSettled: () => {
        onClose?.()
      },
    })
  }, [createEmptyDataset, memberList, onClose])

  return (
    <Modal
      isShow={show}
      onClose={onClose}
      className='max-w-[520px] p-0'
    >
      <CreateForm
        onCreate={handleCreate}
        onClose={onClose}
      />
    </Modal>
  )
}

export default ApplyTemplateModal
