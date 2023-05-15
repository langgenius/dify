const registerAPI = function (app) {
  const coversationList = [
    {
      id: '1',
      name: '梦的解析',
      inputs: {
        book: '《梦的解析》',
        callMe: '大师',
      },
      chats: []
    },
    {
      id: '2',
      name: '生命的起源',
      inputs: {
        book: '《x x x》',
      }
    },
  ]
  // site info
  app.get('/apps/site/info', async (req, res) => {
    // const id = req.params.id
    res.send({
      enable_site: true,
      appId: '1',
      site: {
        title: 'Story Bot',
        description: '这是一款解梦聊天机器人，你可以选择你喜欢的解梦人进行解梦，这句话是客户端应用说明',
      },
      prompt_public: true, //id === '1',
      prompt_template: '你是我的解梦小助手，请参考 {{book}} 回答我有关梦境的问题。在回答前请称呼我为 {{myName}}。',
    })
  })

  app.post('/apps/:id/chat-messages', async (req, res) => {
    const conversationId = req.body.conversation_id ? req.body.conversation_id : Date.now() + ''
    res.send({
      id: Date.now() + '',
      conversation_id: Date.now() + '',
      answer: 'balabababab'
    })
  })

  app.post('/apps/:id/completion-messages', async (req, res) => {
    res.send({
      id: Date.now() + '',
      answer: `做为一个AI助手，我可以为你提供随机生成的段落，这些段落可以用于测试、占位符、或者其他目的。以下是一个随机生成的段落：

      “随着科技的不断发展，越来越多的人开始意识到人工智能的重要性。人工智能已经成为我们生活中不可或缺的一部分，它可以帮助我们完成很多繁琐的工作，也可以为我们提供更智能、更便捷的服务。虽然人工智能带来了很多好处，但它也面临着很多挑战。例如，人工智能的算法可能会出现偏见，导致对某些人群不公平。此外，人工智能的发展也可能会导致一些工作的失业。因此，我们需要不断地研究人工智能的发展，以确保它能够为人类带来更多的好处。”`
    })
  })

  // share api
  // chat list
  app.get('/apps/:id/coversations', async (req, res) => {
    res.send({
      data: coversationList
    })
  })



  app.get('/apps/:id/variables', async (req, res) => {
    res.send({
      variables: [
        {
          key: 'book',
          name: '书',
          value: '《梦境解析》',
          type: 'string'
        },
        {
          key: 'myName',
          name: '称呼',
          value: '',
          type: 'string'
        }
      ],
    })
  })

}

module.exports = registerAPI

// const chatList = [
//   {
//     id: 1,
//     content: 'AI 开场白',
//     isAnswer: true,
//   },
//   {
//     id: 2,
//     content: '梦见在山上手撕鬼子，大师解解梦',
//     more: { time: '5.6 秒' },
//   },
//   {
//     id: 3,
//     content: '梦境通常是个人内心深处的反映，很难确定每个人梦境的确切含义，因为它们可能会受到梦境者的文化背景、生活经验和情感状态等多种因素的影响。',
//     isAnswer: true,
//     more: { time: '99 秒' },

//   },
//   {
//     id: 4,
//     content: '梦见在山上手撕鬼子，大师解解梦',
//     more: { time: '5.6 秒' },
//   },
//   {
//     id: 5,
//     content: '梦见在山上手撕鬼子，大师解解梦',
//     more: { time: '5.6 秒' },
//   },
//   {
//     id: 6,
//     content: '梦见在山上手撕鬼子，大师解解梦',
//     more: { time: '5.6 秒' },
//   },
// ]