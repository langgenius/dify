const translation = {
  nodes: {
    common: {
      outputVars: '输出变量',
      insertVarTip: '插入变量',
    },
    directAnswer: {
      answer: '回复',
      inputVars: '输入变量',
    },
    llm: {
      model: '模型',
      variables: '变量',
      context: '上下文',
      prompt: '提示词',
      vision: '视觉',
      outputVars: {
        output: '生成内容',
        usage: '模型用量信息',
      },
    },
    http: {
      inputVars: '输入变量',
      api: 'API',
      headers: '响应头',
      params: '参数',
      body: '响应内容',
      outputVars: {
        body: '响应内容',
        statusCode: '响应状态码',
        headers: '响应头列表 JSON',
      },
    },
    code: {
      inputVars: '输入变量',
      outputVars: '输出变量',
    },
    templateTransform: {
      inputVars: '输入变量',
      code: '代码',
      codeSupportTip: '只支持 Jinja2',
      outputVars: {
        output: '转换后内容',
      },
    },
  },
}

export default translation
