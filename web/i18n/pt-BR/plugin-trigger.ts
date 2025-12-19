const translation = {
  subscription: {
    title: 'Assinaturas',
    listNum: 'Assinaturas {{num}}',
    empty: {
      title: 'Sem assinaturas',
      button: 'Nova assinatura',
    },
    createButton: {
      oauth: 'Nova assinatura com OAuth',
      apiKey: 'Nova assinatura com chave de API',
      manual: 'Cole a URL para criar uma nova assinatura',
    },
    createSuccess: 'Assinatura criada com sucesso',
    createFailed: 'Falha ao criar assinatura',
    maxCount: 'Máximo de {{num}} assinaturas',
    selectPlaceholder: 'Selecionar assinatura',
    noSubscriptionSelected: 'Nenhuma assinatura selecionada',
    subscriptionRemoved: 'Assinatura removida',
    list: {
      title: 'Assinaturas',
      addButton: 'Adicionar',
      tip: 'Receber eventos via Assinatura',
      item: {
        enabled: 'Habilitado',
        disabled: 'Desativado',
        credentialType: {
          api_key: 'Chave de API',
          oauth2: 'OAuth',
          unauthorized: 'Manual',
        },
        actions: {
          delete: 'Excluir',
          deleteConfirm: {
            title: 'Excluir {{name}}?',
            success: 'Assinatura {{name}} excluída com sucesso',
            error: 'Falha ao excluir a assinatura {{name}}',
            content: 'Uma vez excl assinada, esta assinatura não pode ser recuperada. Por favor, confirme.',
            contentWithApps: 'A assinatura atual é referenciada por {{count}} aplicativos. Excluí-la fará com que os aplicativos configurados parem de receber eventos da assinatura.',
            confirm: 'Confirmar Exclusão',
            cancel: 'Cancelar',
            confirmInputWarning: 'Por favor, insira o nome correto para confirmar.',
            confirmInputPlaceholder: 'Digite "{{name}}" para confirmar.',
            confirmInputTip: 'Por favor, digite “{{name}}” para confirmar.',
          },
        },
        status: {
          active: 'Ativo',
          inactive: 'Inativo',
        },
        usedByNum: 'Usado por {{num}} fluxos de trabalho',
        noUsed: 'Nenhum fluxo de trabalho usado',
      },
    },
    addType: {
      title: 'Adicionar assinatura',
      description: 'Escolha como você deseja criar sua assinatura de gatilho',
      options: {
        apikey: {
          title: 'Criar com Chave de API',
          description: 'Criar assinatura automaticamente usando credenciais da API',
        },
        oauth: {
          title: 'Criar com OAuth',
          description: 'Autorizar com plataforma de terceiros para criar assinatura',
          clientSettings: 'Configurações do Cliente OAuth',
          clientTitle: 'Cliente OAuth',
          default: 'Padrão',
          custom: 'Personalizado',
        },
        manual: {
          title: 'Configuração Manual',
          description: 'Cole a URL para criar uma nova assinatura',
          tip: 'Configure a URL na plataforma de terceiros manualmente',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Verificar',
      configuration: 'Configuração',
    },
    common: {
      cancel: 'Cancelar',
      back: 'Voltar',
      next: 'Próximo',
      create: 'Criar',
      verify: 'Verificar',
      authorize: 'Autorizar',
      creating: 'Criando...',
      verifying: 'Verificando...',
      authorizing: 'Autorizando...',
    },
    oauthRedirectInfo: 'Nenhum segredo de cliente do sistema foi encontrado para este provedor de ferramenta, é necessário configurá-lo manualmente; para redirect_uri, por favor use',
    apiKey: {
      title: 'Criar com Chave de API',
      verify: {
        title: 'Verificar Credenciais',
        description: 'Por favor, forneça suas credenciais de API para verificar o acesso',
        error: 'Falha na verificação de credenciais. Por favor, verifique sua chave de API.',
        success: 'Credenciais verificadas com sucesso',
      },
      configuration: {
        title: 'Configurar Assinatura',
        description: 'Configure os parâmetros da sua assinatura',
      },
    },
    oauth: {
      title: 'Criar com OAuth',
      authorization: {
        title: 'Autorização OAuth',
        description: 'Autorize o Dify a acessar sua conta',
        redirectUrl: 'Redirecionar URL',
        redirectUrlHelp: 'Use este URL na configuração do seu aplicativo OAuth',
        authorizeButton: 'Autorizar com {{provider}}',
        waitingAuth: 'Aguardando autorização...',
        authSuccess: 'Autorização bem-sucedida',
        authFailed: 'Falha ao obter informações de autorização OAuth',
        waitingJump: 'Autorizado, aguardando decolagem',
      },
      configuration: {
        title: 'Configurar Assinatura',
        description: 'Configure os parâmetros da sua assinatura após a autorização',
        success: 'Configuração do OAuth bem-sucedida',
        failed: 'Falha na configuração do OAuth',
      },
      remove: {
        success: 'Remoção do OAuth bem-sucedida',
        failed: 'Falha ao remover OAuth',
      },
      save: {
        success: 'Configuração do OAuth salva com sucesso',
      },
    },
    manual: {
      title: 'Configuração Manual',
      description: 'Configure sua assinatura de webhook manualmente',
      logs: {
        title: 'Registros de Solicitações',
        request: 'Solicitação',
        loading: 'Aguardando solicitação de {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Nome da Assinatura',
        placeholder: 'Digite o nome da assinatura',
        required: 'O nome da assinatura é obrigatório',
      },
      callbackUrl: {
        label: 'URL de Retorno de Chamada',
        description: 'Esta URL receberá eventos de webhook',
        tooltip: 'Forneça um endpoint acessível publicamente que possa receber solicitações de retorno de chamada do provedor de gatilho.',
        placeholder: 'Gerando...',
        privateAddressWarning: 'Este URL parece ser um endereço interno, o que pode fazer com que as solicitações do webhook falhem. Você pode alterar o TRIGGER_URL para um endereço público.',
      },
    },
    errors: {
      createFailed: 'Falha ao criar assinatura',
      verifyFailed: 'Falha ao verificar as credenciais',
      authFailed: 'Autorização falhou',
      networkError: 'Erro de rede, por favor tente novamente',
    },
  },
  events: {
    title: 'Eventos Disponíveis',
    description: 'Eventos aos quais este plugin de gatilho pode se inscrever',
    empty: 'Nenhum evento disponível',
    event: 'Evento',
    events: 'Eventos',
    actionNum: '{{num}} {{event}} INCLUÍDO',
    item: {
      parameters: 'parâmetros {{count}}',
      noParameters: 'Sem parâmetros',
    },
    output: 'Saída',
  },
  node: {
    status: {
      warning: 'Desconectar',
    },
  },
}

export default translation
