import { IS_CE_EDITION } from '@/config'

export type ConversationField = {
  id: string,
  value: any,
}

declare global {
  // eslint-disable-next-line ts/consistent-type-definitions
  interface Window {
    zE?: (
      command: string,
      value: string,
      payload?: ConversationField[] | string | string[] | (() => any),
      callback?: () => any,
    ) => void;
  }
}

export const setZendeskConversationFields = (fields: ConversationField[], callback?: () => any) => {
  if (!IS_CE_EDITION && window.zE)
    window.zE('messenger:set', 'conversationFields', fields, callback)
}

export const setZendeskWidgetVisibility = (visible: boolean) => {
  if (!IS_CE_EDITION && window.zE)
    window.zE('messenger', visible ? 'show' : 'hide')
}

export const toggleZendeskWindow = (open: boolean) => {
  if (!IS_CE_EDITION && window.zE)
    window.zE('messenger', open ? 'open' : 'close')
}
