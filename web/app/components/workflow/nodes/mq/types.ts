import type { CommonNodeType } from '@/app/components/workflow/types'

export type MqNodeType = CommonNodeType & {
    channelName: string
    message: string
}
