import { useMutation } from '@tanstack/react-query'
import { create } from 'zustand'
import { sendDeleteAccountCode, submitDeleteAccountFeedback, verifyDeleteAccountCode } from '@/service/common'

type State = {
  sendEmailToken: string
  setSendEmailToken: (token: string) => void
}

export const useAccountDeleteStore = create<State>(set => ({
  sendEmailToken: '',
  setSendEmailToken: (token: string) => set({ sendEmailToken: token }),
}))

export function useSendDeleteAccountEmail() {
  const updateEmailToken = useAccountDeleteStore(state => state.setSendEmailToken)
  return useMutation({
    mutationKey: ['delete-account'],
    mutationFn: sendDeleteAccountCode,
    onSuccess: (ret) => {
      if (ret.result === 'success')
        updateEmailToken(ret.data)
    },
  })
}

export function useConfirmDeleteAccount() {
  return useMutation({
    mutationKey: ['confirm-delete-account'],
    mutationFn: verifyDeleteAccountCode,
  })
}

export function useDeleteAccountFeedback() {
  return useMutation({
    mutationKey: ['delete-account-feedback'],
    mutationFn: submitDeleteAccountFeedback,
  })
}
