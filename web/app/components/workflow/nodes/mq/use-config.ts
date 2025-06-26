import { useCallback } from 'react'
import produce from 'immer'
import { VarType } from '../../types'
import type { Var } from '../../types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
    useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import type { MqNodeType } from '@/app/components/workflow/nodes/mq/types'

const useConfig = (id: string, payload: MqNodeType) => {
    const { nodesReadOnly: readOnly } = useNodesReadOnly()
    const { inputs, setInputs } = useNodeCrud<MqNodeType>(id, payload)

    const handleChannelNameChange = useCallback((value: string) => {
        const newInputs = produce(inputs, (draft) => {
            draft.channelName = value
        })
        setInputs(newInputs)
    }, [inputs, setInputs])
    const handleMessageChange = useCallback((value: string) => {
        const newInputs = produce(inputs, (draft) => {
            draft.message = value
        })
        setInputs(newInputs)
    }, [inputs, setInputs])

    const filterVar = useCallback((varPayload: Var) => {
        return varPayload.type !== VarType.arrayObject
    }, [])
    return {
        readOnly,
        inputs,
        handleChannelNameChange,
        handleMessageChange,
        filterVar,
    }
}

export default useConfig
