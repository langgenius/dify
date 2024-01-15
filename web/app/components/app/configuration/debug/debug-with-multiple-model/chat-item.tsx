import type { FC } from 'react'
import type { ModelAndParameter } from '../types'
import { Chat } from '@/app/components/base/chat'
import { useChat } from '@/app/components/base/chat/hooks'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import type { ChatConfig } from '@/app/components/base/chat/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useProviderContext } from '@/context/provider-context'

type ChatItemProps = {
  modelAndParameter: ModelAndParameter
}
const ChatItem: FC<ChatItemProps> = ({
  modelAndParameter,
}) => {
  const {
    appId,
    inputs,
    speechToTextConfig,
    introduction,
    moreLikeThisConfig,
  } = useDebugConfigurationContext()
  const { textGenerationModelList } = useProviderContext()
  const config: ChatConfig = {
    speech_to_text: speechToTextConfig,
    opening_statement: introduction,
    suggested_questions_after_answer: moreLikeThisConfig,
  }
  const {
    chatList,
    conversationId,
    handleSend,
  } = useChat(config, [
    {
      id: '1',
      content: 'hello',
      isAnswer: false,
    },
    {
      id: '2,',
      content: `您好，地球人！欢迎来到Python最佳实践指南。

      这是一份活着的、会呼吸的指南。 如果您有意一起贡献, 在GitHub fork 我!
      
      这份人工编写的指南旨在为Python初学者和专家提供一个 关于Python安装、配置、和日常使用的最佳实践手册。
      
      这份指南是 主观的 ，它与Python官方文档几乎，但不是完全 不同 。您在这不会找到每个Python web框架的列表。 相反，您会发现一份优秀的简明列表，包含有强烈推荐的选项。
      
      注解
      使用 Python 3 是 高度 优先于 Python 2。如果您发现自己 仍然 在生产环境中使用 Python 2，请考虑升级您的应用程序和基础设施。如果您正在使用 Python 3，恭喜您 —— 您确实有很好的品味。 ——Kenneth Reitz
      
      让我们开始吧！但首先，让我们确保您拥有这次旅行需要的"浴巾"。（译者注：towel 浴巾的梗引自著名科幻小说《银河系漫游指南》，大概是说先准备好不起眼但很重要的东西。）
      
      Python入门
      Python新手？让我们正确地设置您的Python环境：
      
      选择一个 Python 解释器（3 vs 2）
      Python的现状 (2 vs 3)
      建议
      所以.... 3？
      实现
      正确地在您的系统上安装 Python
      正确地安装 Python
      在Mac OS X上安装Python 3
      Setuptools + Pip
      Pipenv & 虚拟环境
      在Linux上安装Python 3
      在Mac OS X上安装Python 2
      在Windows上安装Python 2
      在Linux上安装Python 2
      借助 Pipenv 使用虚拟环境：
      Pipenv & 虚拟环境
      确保您已经有了 Python 和 pip
      安装 Pipenv
      为您的项目安装包
      使用安装好的包
      下一步
      更低层次: virtualenv
      基本使用
      其他注意事项
      virtualenvwrapper
      基本使用
      其他有用的命令
      virtualenv-burrito
      autoenv
      Python 开发环境
      这部分指南关注 Python 开发环境，以及用于编写 Python 代码的可用且最实用的工具。
      
      您的开发环境
      文本编辑器
      IDEs
      解释器工具
      其他工具
      Pipenv & 虚拟环境
      确保您已经有了 Python 和 pip
      安装 Pipenv
      为您的项目安装包
      使用安装好的包
      下一步
      更低层次: virtualenv
      基本使用
      其他注意事项
      virtualenvwrapper
      基本使用
      其他有用的命令
      virtualenv-burrito
      autoenv
      Pip和Virtualenv的更多配置
      用 pip 来要求一个激活的虚拟环境
      存下包以供将来使用
      写出优雅的Python代码
      这部分指南关注编写Python代码的最佳实践。
      
      结构化您的工程
      仓库的结构
      结构是一把钥匙
      模块
      包
      面向对象编程
      装饰器
      上下文管理器
      动态类型`,
      isAnswer: true,
    },
  ])

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === 'app-chat-with-multiple-model') {
      const currentProvider = textGenerationModelList.find(item => item.provider === modelAndParameter.provider)
      const currentModel = currentProvider?.models.find(model => model.model === modelAndParameter.model)
      handleSend(
        `apps/${appId}/chat-messages`,
        {
          query: v.payload.message,
          conversation_id: conversationId,
          inputs,
          model_config: {
            ...config,
            model: {
              provider: modelAndParameter.provider,
              name: modelAndParameter.model,
              mode: currentModel?.model_properties.mode,
              completion_params: modelAndParameter.parameters,
            },
          },
        },
      )
    }
  })

  return (
    <Chat
      config={config}
      chatList={chatList}
      noChatInput
      conversationClassName='p-4'
    />
  )
}

export default ChatItem
