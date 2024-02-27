const translation = {
  nodes: {
    common: {
      outputVars: '输出变量',
      insertVarTip: '插入变量',
    },
    start: {
      required: '必填',
      builtInVar: '内置变量',
      outputVars: {
        query: '用户输入',
        memories: {
          des: '会话历史',
          type: '消息类型',
          content: '消息内容',
        },
        files: '文件列表',
      },
      noVarTip: '设置的输入可在工作流程中使用',
    },
    end: {
      outputs: '输出',
      output: {
        type: '输出类型',
        variable: '输出变量',
      },
      type: {
        'none': '无',
        'plain-text': '纯文本',
        'structured': '结构化',
      },
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
    ifElse: {
      conditions: '条件',
      and: 'and',
      or: 'or',
      comparisonOperator: {
        'contains': '包含',
        'not contains': '不包含',
        'start with': '开始是',
        'end with': '结束是',
        'is': '是',
        'is not': '不是',
        'empty': '为空',
        'not empty': '不为空',
        'null': '空',
        'not null': '不为空',
      },
      enterValue: '输入值',
    },
    variableAssigner: {
      title: '变量赋值',
      outputType: '输出类型',
      outputVarType: '输出变量类型',
      varNotSet: '未设置变量',
      noVarTip: '添加需要赋值的变量',
      type: {
        string: 'String',
        number: 'Number',
        object: 'Object',
        array: 'Array',
      },
    },
  },
}

export default translation
