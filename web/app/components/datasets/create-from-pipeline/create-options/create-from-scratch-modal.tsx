import React, { useCallback, useEffect, useState } from 'react'
import type { CreateDatasetReq } from '@/models/datasets'
import { ChunkingMode, DatasetPermission } from '@/models/datasets'
import { useMembers } from '@/service/use-common'
import { useCreatePipelineDataset } from '@/service/knowledge/use-create-dataset'
import type { Member } from '@/models/common'
import CreateForm from '../create-form'
import type { CreateFormData } from '@/models/pipeline'
import Modal from '@/app/components/base/modal'
import { useRouter } from 'next/navigation'
import Toast from '@/app/components/base/toast'
import { useTranslation } from 'react-i18next'
import { useResetDatasetList } from '@/service/knowledge/use-dataset'

type CreateFromScratchModalProps = {
  show: boolean
  onClose: () => void
}

const CreateFromScratchModal = ({
  show,
  onClose,
}: CreateFromScratchModalProps) => {
  const { t } = useTranslation()
  const { push } = useRouter()
  const [memberList, setMemberList] = useState<Member[]>([])
  const { data: members } = useMembers()

  useEffect(() => {
    if (members?.accounts)
      setMemberList(members.accounts)
  }, [members])

  const { mutateAsync: createEmptyDataset } = useCreatePipelineDataset()
  const resetDatasetList = useResetDatasetList()

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
      onSuccess: (data) => {
        if (data) {
          const { id } = data
          Toast.notify({
            type: 'success',
            message: t('datasetPipeline.creation.successTip'),
          })
          resetDatasetList()
          push(`/datasets/${id}/pipeline`)
        }
      },
      onError: () => {
        Toast.notify({
          type: 'error',
          message: t('datasetPipeline.creation.errorTip'),
        })
      },
      onSettled: () => {
        onClose?.()
      },
    })
  }, [createEmptyDataset, memberList, onClose, push, resetDatasetList, t])

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

export default CreateFromScratchModal
