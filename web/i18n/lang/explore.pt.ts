const translation = {
  title: 'Minhas Aplicações',
  sidebar: {
    discovery: 'Descoberta',
    chat: 'Chat',
    workspace: 'Espaço de Trabalho',
    action: {
      pin: 'Fixar',
      unpin: 'Desafixar',
      rename: 'Renomear',
      delete: 'Excluir',
    },
    delete: {
      title: 'Excluir aplicativo',
      content: 'Tem certeza de que deseja excluir este aplicativo?',
    },
  },
  apps: {
    title: 'Explorar Aplicações por Dify',
    description: 'Use esses aplicativos modelo instantaneamente ou personalize seus próprios aplicativos com base nos modelos.',
    allCategories: 'Todas as Categorias',
  },
  appCard: {
    addToWorkspace: 'Adicionar ao Espaço de Trabalho',
    customize: 'Personalizar',
  },
  appCustomize: {
    title: 'Criar aplicativo a partir de {{name}}',
    subTitle: 'Ícone e nome do aplicativo',
    nameRequired: 'O nome do aplicativo é obrigatório',
  },
  category: {
    Assistant: 'Assistente',
    Writing: 'Escrita',
    Translate: 'Traduzir',
    Programming: 'Programação',
    HR: 'RH',
  },
  universalChat: {
    welcome: 'Iniciar chat com Dify',
    welcomeDescribe: 'Seu companheiro de conversa de IA para assistência personalizada',
    model: 'Modelo',
    plugins: {
      name: 'Plugins',
      google_search: {
        name: 'Pesquisa do Google',
        more: {
          left: 'Ative o plugin, ',
          link: 'configure sua chave SerpAPI',
          right: ' primeiro.',
        },
      },
      web_reader: {
        name: 'Leitor da Web',
        description: 'Obtenha informações necessárias de qualquer link da web',
      },
      wikipedia: {
        name: 'Wikipedia',
      },
    },
    thought: {
      show: 'Mostrar',
      hide: 'Ocultar',
      processOfThought: ' o processo de pensamento',
      res: {
        webReader: {
          normal: 'Lendo {url}',
          hasPageInfo: 'Lendo próxima página de {url}',
        },
        google: 'Pesquisando no Google {{query}}',
        wikipedia: 'Pesquisando na Wikipedia {{query}}',
        dataset: 'Recuperando Conhecimento {datasetName}',
        date: 'Pesquisando data',
      },
    },
    viewConfigDetailTip: 'Na conversa, não é possível alterar as configurações acima',
  },
}

export default translation
