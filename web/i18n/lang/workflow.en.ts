const translation = {
  nodes: {
    common: {
      outputVars: 'Output Variables',
      insertVarTip: 'Insert Variable',
    },
    start: {
      required: 'required',
    },
    end: {
      outputs: 'Outputs',
      type: {
        'none': 'None',
        'plain-text': 'Plain Text',
        'structured': 'Structured',
      },
    },
    directAnswer: {
      answer: 'Answer',
      inputVars: 'Input Variables',
    },
    llm: {
      model: 'model',
      variables: 'variables',
      context: 'context',
      prompt: 'prompt',
      vision: 'vision',
      outputVars: {
        output: 'Generate content',
        usage: 'Model Usage Information',
      },
    },
    http: {
      inputVars: 'Input Variables',
      api: 'API',
      headers: 'Headers',
      params: 'Params',
      body: 'Body',
      outputVars: {
        body: 'Response Content',
        statusCode: 'Response Status Code',
        headers: 'Response Header List JSON',
      },
    },
    code: {
      inputVars: 'Input Variables',
      outputVars: 'Output Variables',
    },
    templateTransform: {
      inputVars: 'Input Variables',
      code: 'Code',
      codeSupportTip: 'Only supports Jinja2',
      outputVars: {
        output: 'Transformed content',
      },
    },
    ifElse: {
      conditions: 'Conditions',
      and: 'and',
      or: 'or',
      comparisonOperator: {
        'contains': 'contains',
        'not contains': 'not contains',
        'start with': 'start with',
        'end with': 'end with',
        'is': 'is',
        'is not': 'is not',
        'empty': 'empty',
        'not empty': 'not empty',
        'null': 'is null',
        'not null': 'is not null',
      },
    },
  },
}

export default translation
