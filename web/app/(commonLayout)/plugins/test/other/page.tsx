'use client'
import { useBoolean } from 'ahooks'
import UpdatePlugin from '@/app/components/plugins/update-plugin'

const Page = () => {
  const [isShowUpdateModal, {
    setTrue: showUpdateModal,
    setFalse: hideUpdateModal,
  }] = useBoolean(false)
  return (
    <div>
      <div onClick={showUpdateModal}>Show Upgrade</div>
      {isShowUpdateModal && (
        <UpdatePlugin onHide={hideUpdateModal} />
      )}
    </div>
  )
}

export default Page
