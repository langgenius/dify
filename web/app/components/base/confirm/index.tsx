import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import ConfirmUI from '../confirm-ui'
import { useTranslation } from 'react-i18next'

// https://headlessui.com/react/dialog

type IConfirm = {
  className?: string
  isShow: boolean
  onClose: () => void
  type?: 'info' | 'warning'
  title: string
  content: string
  confirmText?: string
  onConfirm: () => void
  cancelText?: string
  onCancel: () => void
}

export default function Confirm({
  isShow,
  onClose,
  type = 'warning',
  title,
  content,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}: IConfirm) {
  const { t } = useTranslation()
  const confirmTxt = confirmText || `${t('common.operation.confirm')}`
  const cancelTxt = cancelText || `${t('common.operation.cancel')}`
  return (
    <Transition appear show={isShow} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={onClose} onClick={e => e.preventDefault()}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex items-center justify-center min-h-full p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className={'w-full max-w-md transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl transition-all'}>
                <ConfirmUI
                  type={type}
                  title={title}
                  content={content}
                  confirmText={confirmTxt}
                  cancelText={cancelTxt}
                  onConfirm={onConfirm}
                  onCancel={onCancel}
                />
              </Dialog.Panel>
            </Transition.Child>

          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
