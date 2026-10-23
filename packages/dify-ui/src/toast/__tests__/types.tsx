import type { ToastApi } from '@langgenius/dify-ui/toast'

export function toastActionTypeContracts(toast: ToastApi) {
  const id = toast('Saved', {
    type: 'success',
    actionProps: { children: 'Undo', variant: 'primary' },
  })
  toast.success('Saved', {
    actionProps: { children: 'Undo', variant: 'secondary' },
  })
  toast.update(id, {
    actionProps: { children: 'Retry', variant: 'tertiary' },
  })
  void toast.promise(Promise.resolve('Download'), {
    loading: 'Preparing download',
    success: (label) => ({
      title: 'Ready',
      actionProps: { children: label, variant: 'primary' },
    }),
    error: {
      title: 'Failed',
      actionProps: { children: 'Retry', variant: 'secondary' },
    },
  })
  toast.info('Saved', {
    // @ts-expect-error Action variants are owned by Button.
    actionProps: { children: 'Undo', variant: 'custom' },
  })
  toast.info('Saved', {
    // @ts-expect-error Action rendering is owned by ToastCard.
    actionProps: { children: 'Undo', render: <button /> },
  })
}
