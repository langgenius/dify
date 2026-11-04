import { useMutation } from '@tanstack/react-query'
import { create } from 'zustand'
import { consoleClient } from '@/service/console'

type State = {
  sendEmailToken: string
  setSendEmailToken: (token: string) => void
}

export const useAccountDeleteStore = create<State>((set) => ({
  sendEmailToken: '',
  setSendEmailToken: (token: string) => set({ sendEmailToken: token }),
}))

export function useSendDeleteAccountEmail() {
  const updateEmailToken = useAccountDeleteStore((state) => state.setSendEmailToken)
  return useMutation({
    mutationKey: ['delete-account'],
    mutationFn: () => consoleClient.account.delete.verify.get(),
    onSuccess: (ret) => {
      if (ret.result === 'success') updateEmailToken(ret.data)
    },
  })
}

export function useConfirmDeleteAccount() {
  return useMutation({
    mutationKey: ['confirm-delete-account'],
    mutationFn: (body: { code: string; token: string }) =>
      consoleClient.account.delete.post({ body }),
  })
}

export function useDeleteAccountFeedback() {
  return useMutation({
    mutationKey: ['delete-account-feedback'],
    mutationFn: (body: { feedback: string; email: string }) =>
      consoleClient.account.delete.feedback.post({ body }),
  })
}
