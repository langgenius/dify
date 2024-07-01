const translation = {
  welcome: {
    firstStepTip: 'Para começar,',
    enterKeyTip: 'insira sua chave de API OpenAI abaixo',
    getKeyTip: 'Obtenha sua chave de API no painel da OpenAI',
    placeholder: 'Sua chave de API OpenAI (ex. sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Você está usando a cota de teste da {{providerName}}.',
        description: 'A cota de teste é fornecida para seu uso de teste. Antes que as chamadas de cota de teste se esgotem, configure seu próprio provedor de modelo ou compre cota adicional.',
      },
      exhausted: {
        title: 'Sua cota de teste foi usada, configure sua chave de API.',
        description: 'Sua cota de teste foi esgotada. Configure seu próprio provedor de modelo ou compre cota adicional.',
      },
    },
    selfHost: {
      title: {
        row1: 'Para começar,',
        row2: 'configure primeiro seu provedor de modelo.',
      },
    },
    callTimes: 'Número de chamadas',
    usedToken: 'Tokens usados',
    setAPIBtn: 'Ir para configurar o provedor de modelo',
    tryCloud: 'Ou experimente a versão em nuvem do Dify com cota gratuita',
  },
  overview: {
    title: 'Visão Geral',
    appInfo: {
      explanation: 'WebApp de IA Pronta para Uso',
      accessibleAddress: 'URL Pública',
      preview: 'Visualização',
      regenerate: 'Regenerar',
      regenerateNotice: 'Você deseja regenerar a URL pública?',
      preUseReminder: 'Por favor, ative o WebApp antes de continuar.',
      settings: {
        entry: 'Configurações',
        title: 'Configurações do WebApp',
        webName: 'Nome do WebApp',
        webDesc: 'Descrição do WebApp',
        webDescTip: 'Este texto será exibido no lado do cliente, fornecendo orientações básicas sobre como usar o aplicativo',
        webDescPlaceholder: 'Insira a descrição do WebApp',
        language: 'Idioma',
        workflow: {
          title: 'Etapas do fluxo de trabalho',
          show: 'Mostrar',
          hide: 'Ocultar',
        },
        chatColorTheme: 'Tema de cor do chatbot',
        chatColorThemeDesc: 'Defina o tema de cor do chatbot',
        chatColorThemeInverted: 'Inve',
        invalidHexMessage: 'Valor hex inválido',
        more: {
          entry: 'Mostrar mais configurações',
          copyright: 'Direitos autorais',
          copyRightPlaceholder: 'Insira o nome do autor ou organização',
          privacyPolicy: 'Política de Privacidade',
          privacyPolicyPlaceholder: 'Insira o link da política de privacidade',
          privacyPolicyTip: 'Ajuda os visitantes a entender os dados coletados pelo aplicativo, consulte a <privacyPolicyLink>Política de Privacidade</privacyPolicyLink> do Dify.',
          customDisclaimer: 'Aviso Legal Personalizado',
          customDisclaimerPlaceholder: 'Insira o texto do aviso legal',
          customDisclaimerTip: 'O texto do aviso legal personalizado será exibido no lado do cliente, fornecendo informações adicionais sobre o aplicativo',
        },
      },
      embedded: {
        entry: 'Embutido',
        title: 'Incorporar no site',
        explanation: 'Escolha a maneira de incorporar o aplicativo de chat ao seu site',
        iframe: 'Para adicionar o aplicativo de chat em qualquer lugar do seu site, adicione este iframe ao seu código HTML.',
        scripts: 'Para adicionar um aplicativo de chat no canto inferior direito do seu site, adicione este código ao seu HTML.',
        chromePlugin: 'Instalar a Extensão do Chrome Dify Chatbot',
        copied: 'Copiado',
        copy: 'Copiar',
      },
      qrcode: {
        title: 'Código QR para compartilhar',
        scan: 'Digitalizar e compartilhar o aplicativo',
        download: 'Baixar código QR',
      },
      customize: {
        way: 'modo',
        entry: 'Personalizar',
        title: 'Personalizar WebApp de IA',
        explanation: 'Você pode personalizar a interface do usuário do Web App para atender às suas necessidades de cenário e estilo.',
        way1: {
          name: 'Faça um fork do código do cliente, modifique-o e implante-o no Vercel (recomendado)',
          step1: 'Faça um fork do código do cliente e modifique-o',
          step1Tip: 'Clique aqui para fazer um fork do código-fonte na sua conta GitHub e modificar o código',
          step1Operation: 'Cliente-Web-Dify',
          step2: 'Implantar no Vercel',
          step2Tip: 'Clique aqui para importar o repositório no Vercel e implantar',
          step2Operation: 'Importar repositório',
          step3: 'Configurar as variáveis de ambiente',
          step3Tip: 'Adicione as seguintes variáveis de ambiente no Vercel',
        },
        way2: {
          name: 'Escreva código do lado do cliente para chamar a API e implante-o em um servidor',
          operation: 'Documentação',
        },
      },
    },
    apiInfo: {
      title: 'API de Serviço de Back-end',
      explanation: 'Facilmente integrado em sua aplicação',
      accessibleAddress: 'Endpoint do Serviço API',
      doc: 'Referência da API',
    },
    status: {
      running: 'Em serviço',
      disable: 'Desabilitar',
    },
  },
  analysis: {
    title: 'Análise',
    ms: 'ms',
    tokenPS: 'Token/s',
    totalMessages: {
      title: 'Total de Mensagens',
      explanation: 'Contagem diária de interações AI; engenharia/de depuração excluída.',
    },
    activeUsers: {
      title: 'Usuários Ativos',
      explanation: 'Usuários únicos engajando em Q&A com AI; engenharia/de depuração excluída.',
    },
    tokenUsage: {
      title: 'Uso de Token',
      explanation: 'Reflete o uso diário do token do modelo de linguagem para o aplicativo, útil para fins de controle de custos.',
      consumed: 'Consumido',
    },
    avgSessionInteractions: {
      title: 'Média de Interações por Sessão',
      explanation: 'Contagem de comunicação contínua entre usuário e AI; para aplicativos baseados em conversação.',
    },
    avgUserInteractions: {
      title: 'Média de Interações por Usuário',
      explanation: 'Reflete a frequência de uso diário dos usuários. Essa métrica reflete a fidelidade do usuário.',
    },
    userSatisfactionRate: {
      title: 'Taxa de Satisfação do Usuário',
      explanation: 'O número de curtidas por 1.000 mensagens. Isso indica a proporção de respostas com as quais os usuários estão altamente satisfeitos.',
    },
    avgResponseTime: {
      title: 'Tempo Médio de Resposta',
      explanation: 'Tempo (ms) para o AI processar/responder; para aplicativos baseados em texto.',
    },
    tps: {
      title: 'Velocidade de Saída do Token',
      explanation: 'Mede o desempenho do LLM. Conta a velocidade de saída de tokens do LLM desde o início da solicitação até a conclusão da saída.',
    },
  },
}

export default translation
