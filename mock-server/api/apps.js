const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_'

function randomString (length) {
  let result = ''
  for (let i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

// https://www.notion.so/55773516a0194781ae211792a44a3663?pvs=4
const VirtualData = new Array(10).fill().map((_, index) => {
  const date = new Date(Date.now() - index * 24 * 60 * 60 * 1000)
  return {
    date: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
    conversation_count: Math.floor(Math.random() * 10) + index,
    terminal_count: Math.floor(Math.random() * 10) + index,
    token_count: Math.floor(Math.random() * 10) + index,
    total_price: Math.floor(Math.random() * 10) + index,
  }
})

const registerAPI = function (app) {
  const apps = [{
    id: '1',
    name: 'chat app',
    mode: 'chat',
    description: 'description01',
    enable_site: true,
    enable_api: true,
    api_rpm: 60,
    api_rph: 3600,
    is_demo: false,
    model_config: {
      provider: 'OPENAI',
      model_id: 'gpt-3.5-turbo',
      configs: {
        prompt_template: '你是我的解梦小助手，请参考 {{book}} 回答我有关梦境的问题。在回答前请称呼我为 {{myName}}。',
        prompt_variables: [
          {
            key: 'book',
            name: '书',
            value: '《梦境解析》',
            type: 'string',
            description: '请具体说下书名'
          },
          {
            key: 'myName',
            name: 'your name',
            value: 'Book',
            type: 'string',
            description: 'please tell me your name'
          }
        ],
        completion_params: {
          max_token: 16,
          temperature: 1, // 0-2
          top_p: 1,
          presence_penalty: 1, // -2-2
          frequency_penalty: 1, // -2-2
        }
      }
    },
    site: {
      access_token: '1000',
      title: 'site 01',
      author: 'John',
      default_language: 'zh-Hans-CN',
      customize_domain: 'http://customize_domain',
      theme: 'theme',
      customize_token_strategy: 'must',
      prompt_public: true
    }
  },
  {
    id: '2',
    name: 'completion app',
    mode: 'completion', // genertation text
    description: 'description 02', // genertation text
    enable_site: false,
    enable_api: false,
    api_rpm: 60,
    api_rph: 3600,
    is_demo: false,
    model_config: {
      provider: 'OPENAI',
      model_id: 'text-davinci-003',
      configs: {
        prompt_template: '你是我的翻译小助手，请把以下内容 {{langA}} 翻译成 {{langB}}，以下的内容：',
        prompt_variables: [
          {
            key: 'langA',
            name: '原始语音',
            value: '中文',
            type: 'string',
            description: '这是中文格式的原始语音'
          },
          {
            key: 'langB',
            name: '目标语言',
            value: '英语',
            type: 'string',
            description: '这是英语格式的目标语言'
          }
        ],
        completion_params: {
          max_token: 16,
          temperature: 1, // 0-2
          top_p: 1,
          presence_penalty: 1, // -2-2
          frequency_penalty: 1, // -2-2
        }
      }
    },
    site: {
      access_token: '2000',
      title: 'site 02',
      author: 'Mark',
      default_language: 'en-US',
      customize_domain: 'http://customize_domain',
      theme: 'theme',
      customize_token_strategy: 'must',
      prompt_public: false
    }
  },
  ]

  const apikeys = [{
    id: '111121312313132',
    token: 'sk-DEFGHJKMNPQRSTWXYZabcdefhijk1234',
    last_used_at: '1679212138000',
    created_at: '1673316000000'
  }, {
    id: '43441242131223123',
    token: 'sk-EEFGHJKMNPQRSTWXYZabcdefhijk5678',
    last_used_at: '1679212721000',
    created_at: '1679212731000'
  }]

  // create app
  app.post('/apps', async (req, res) => {
    apps.push({
      id: apps.length + 1 + '',
      ...req.body,

    })
    res.send({
      result: 'success'
    })
  })

  // app list
  app.get('/apps', async (req, res) => {
    res.send({
      data: apps
    })
  })

  // app detail
  app.get('/apps/:id', async (req, res) => {
    const item = apps.find(item => item.id === req.params.id) || apps[0]
    res.send(item)
  })

  // update app name
  app.post('/apps/:id/name', async (req, res) => {
    const item = apps.find(item => item.id === req.params.id)
    item.name = req.body.name
    res.send(item || null)
  })

  // update app site-enable status
  app.post('/apps/:id/site-enable', async (req, res) => {
    const item = apps.find(item => item.id === req.params.id)
    console.log(item)
    item.enable_site = req.body.enable_site
    res.send(item || null)
  })

  // update app api-enable status
  app.post('/apps/:id/api-enable', async (req, res) => {
    const item = apps.find(item => item.id === req.params.id)
    console.log(item)
    item.enable_api = req.body.enable_api
    res.send(item || null)
  })

  // update app rate-limit
  app.post('/apps/:id/rate-limit', async (req, res) => {
    const item = apps.find(item => item.id === req.params.id)
    console.log(item)
    item.api_rpm = req.body.api_rpm
    item.api_rph = req.body.api_rph
    res.send(item || null)
  })

  // update app url including code
  app.post('/apps/:id/site/access-token-reset', async (req, res) => {
    const item = apps.find(item => item.id === req.params.id)
    console.log(item)
    item.site.access_token = randomString(12)
    res.send(item || null)
  })

  // update app config
  app.post('/apps/:id/site', async (req, res) => {
    const item = apps.find(item => item.id === req.params.id)
    console.log(item)
    item.name = req.body.title
    item.description = req.body.description
    item.prompt_public = req.body.prompt_public
    item.default_language = req.body.default_language
    res.send(item || null)
  })

  // get statistics daily-conversations
  app.get('/apps/:id/statistics/daily-conversations', async (req, res) => {
    const item = apps.find(item => item.id === req.params.id)
    if (item) {
      res.send({
        data: VirtualData
      })
    } else {
      res.send({
        data: []
      })
    }
  })

  // get statistics daily-end-users
  app.get('/apps/:id/statistics/daily-end-users', async (req, res) => {
    const item = apps.find(item => item.id === req.params.id)
    if (item) {
      res.send({
        data: VirtualData
      })
    } else {
      res.send({
        data: []
      })
    }
  })

  // get statistics token-costs
  app.get('/apps/:id/statistics/token-costs', async (req, res) => {
    const item = apps.find(item => item.id === req.params.id)
    if (item) {
      res.send({
        data: VirtualData
      })
    } else {
      res.send({
        data: []
      })
    }
  })

  // update app model config
  app.post('/apps/:id/model-config', async (req, res) => {
    const item = apps.find(item => item.id === req.params.id)
    console.log(item)
    item.model_config = req.body
    res.send(item || null)
  })


  // get api keys list
  app.get('/apps/:id/api-keys', async (req, res) => {
    res.send({
      data: apikeys
    })
  })

  // del api key
  app.delete('/apps/:id/api-keys/:api_key_id', async (req, res) => {
    res.send({
      result: 'success'
    })
  })

  // create api key
  app.post('/apps/:id/api-keys', async (req, res) => {
    res.send({
      id: 'e2424241313131',
      token: 'sk-GEFGHJKMNPQRSTWXYZabcdefhijk0124',
      created_at: '1679216688962'
    })
  })

  // get completion-conversations
  app.get('/apps/:id/completion-conversations', async (req, res) => {
    const data = {
      data: [{
        id: 1,
        from_end_user_id: 'user 1',
        summary: 'summary1',
        created_at: '2023-10-11',
        annotated: true,
        message_count: 100,
        user_feedback_stats: {
          like: 4, dislike: 5
        },
        admin_feedback_stats: {
          like: 1, dislike: 2
        },
        message: {
          message: 'message1',
          query: 'question1',
          answer: 'answer1'
        }
      }, {
        id: 12,
        from_end_user_id: 'user 2',
        summary: 'summary2',
        created_at: '2023-10-01',
        annotated: false,
        message_count: 10,
        user_feedback_stats: {
          like: 2, dislike: 20
        },
        admin_feedback_stats: {
          like: 12, dislike: 21
        },
        message: {
          message: 'message2',
          query: 'question2',
          answer: 'answer2'
        }
      }, {
        id: 13,
        from_end_user_id: 'user 3',
        summary: 'summary3',
        created_at: '2023-10-11',
        annotated: false,
        message_count: 20,
        user_feedback_stats: {
          like: 2, dislike: 0
        },
        admin_feedback_stats: {
          like: 0, dislike: 21
        },
        message: {
          message: 'message3',
          query: 'question3',
          answer: 'answer3'
        }
      }],
      total: 200
    }
    res.send(data)
  })

  // get chat-conversations
  app.get('/apps/:id/chat-conversations', async (req, res) => {
    const data = {
      data: [{
        id: 1,
        from_end_user_id: 'user 1',
        summary: 'summary1',
        created_at: '2023-10-11',
        read_at: '2023-10-12',
        annotated: true,
        message_count: 100,
        user_feedback_stats: {
          like: 4, dislike: 5
        },
        admin_feedback_stats: {
          like: 1, dislike: 2
        },
        message: {
          message: 'message1',
          query: 'question1',
          answer: 'answer1'
        }
      }, {
        id: 12,
        from_end_user_id: 'user 2',
        summary: 'summary2',
        created_at: '2023-10-01',
        annotated: false,
        message_count: 10,
        user_feedback_stats: {
          like: 2, dislike: 20
        },
        admin_feedback_stats: {
          like: 12, dislike: 21
        },
        message: {
          message: 'message2',
          query: 'question2',
          answer: 'answer2'
        }
      }, {
        id: 13,
        from_end_user_id: 'user 3',
        summary: 'summary3',
        created_at: '2023-10-11',
        annotated: false,
        message_count: 20,
        user_feedback_stats: {
          like: 2, dislike: 0
        },
        admin_feedback_stats: {
          like: 0, dislike: 21
        },
        message: {
          message: 'message3',
          query: 'question3',
          answer: 'answer3'
        }
      }],
      total: 200
    }
    res.send(data)
  })

  // get completion-conversation detail
  app.get('/apps/:id/completion-conversations/:cid', async (req, res) => {
    const data =
    {
      id: 1,
      from_end_user_id: 'user 1',
      summary: 'summary1',
      created_at: '2023-10-11',
      annotated: true,
      message: {
        message: 'question1',
        // query: 'question1',
        answer: 'answer1',
        annotation: {
          content: '这是一段纠正的内容'
        }
      },
      model_config: {
        provider: 'openai',
        model_id: 'model_id',
        configs: {
          prompt_template: '你是我的翻译小助手，请把以下内容 {{langA}} 翻译成 {{langB}}，以下的内容：{{content}}'
        }
      }
    }
    res.send(data)
  })

  // get chat-conversation detail
  app.get('/apps/:id/chat-conversations/:cid', async (req, res) => {
    const data =
    {
      id: 1,
      from_end_user_id: 'user 1',
      summary: 'summary1',
      created_at: '2023-10-11',
      annotated: true,
      message: {
        message: 'question1',
        // query: 'question1',
        answer: 'answer1',
        created_at: '2023-08-09 13:00',
        provider_response_latency: 130,
        message_tokens: 230
      },
      model_config: {
        provider: 'openai',
        model_id: 'model_id',
        configs: {
          prompt_template: '你是我的翻译小助手，请把以下内容 {{langA}} 翻译成 {{langB}}，以下的内容：{{content}}'
        }
      }
    }
    res.send(data)
  })

  // get chat-conversation message list
  app.get('/apps/:id/chat-messages', async (req, res) => {
    const data = {
      data: [{
        id: 1,
        created_at: '2023-10-11 07:09',
        message: '请说说人为什么会做梦？' + req.query.conversation_id,
        answer: '梦境通常是个人内心深处的反映，很难确定每个人梦境的确切含义，因为它们可能会受到梦境者的文化背景、生活经验和情感状态等多种因素的影响。',
        provider_response_latency: 450,
        answer_tokens: 200,
        annotation: {
          content: 'string',
          account: {
            id: 'string',
            name: 'string',
            email: 'string'
          }
        },
        feedbacks: {
          rating: 'like',
          content: 'string',
          from_source: 'log'
        }
      }, {
        id: 2,
        created_at: '2023-10-11 8:23',
        message: '夜里经常做梦会影响次日的精神状态吗?',
        answer: '总之，这个梦境可能与梦境者的个人经历和情感状态有关，但在一般情况下，它可能表示一种强烈的情感反应，包括愤怒、不满和对于正义和自由的渴望。',
        provider_response_latency: 400,
        answer_tokens: 250,
        annotation: {
          content: 'string',
          account: {
            id: 'string',
            name: 'string',
            email: 'string'
          }
        },
        // feedbacks: {
        //   rating: 'like',
        //   content: 'string',
        //   from_source: 'log'
        // }
      }, {
        id: 3,
        created_at: '2023-10-11 10:20',
        message: '梦见在山上手撕鬼子，大师解解梦',
        answer: '但是，一般来说，“手撕鬼子”这个场景可能是梦境者对于过去历史上的战争、侵略以及对于自己国家和族群的保护与维护的情感反应。在梦中，你可能会感到自己充满力量和勇气，去对抗那些看似强大的侵略者。',
        provider_response_latency: 288,
        answer_tokens: 100,
        annotation: {
          content: 'string',
          account: {
            id: 'string',
            name: 'string',
            email: 'string'
          }
        },
        feedbacks: {
          rating: 'dislike',
          content: 'string',
          from_source: 'log'
        }
      }],
      limit: 20,
      has_more: true
    }
    res.send(data)
  })

  app.post('/apps/:id/annotations', async (req, res) => {
    res.send({ result: 'success' })
  })

  app.post('/apps/:id/feedbacks', async (req, res) => {
    res.send({ result: 'success' })
  })

}

module.exports = registerAPI