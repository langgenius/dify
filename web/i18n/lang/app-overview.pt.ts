const translation = {
  welcome: {
    firstStepTip: 'Para começar,',
    enterKeyTip: 'insira sua chave de API do OpenAI abaixo',
    getKeyTip: 'Obtenha sua chave de API no painel do OpenAI',
    placeholder: 'Sua chave de API do OpenAI (por exemplo, sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Você está usando a cota de teste do {{providerName}}.',
        description: 'A cota de teste é fornecida para uso de teste. Antes que as chamadas da cota de teste se esgotem, configure seu próprio provedor de modelo ou compre uma cota adicional.',
      },
      exhausted: {
        title: 'Sua cota de teste foi esgotada, configure sua chave de API.',
        description: 'Sua cota de teste foi esgotada. Configure seu próprio provedor de modelo ou compre uma cota adicional.',
      },
    },
    selfHost: {
      title: {
        row1: 'Para começar,',
        row2: 'configure seu próprio provedor de modelo primeiro.',
      },
    },
    callTimes: 'Número de chamadas',
    usedToken: 'Tokens usados',
    setAPIBtn: 'Ir para configurar provedor de modelo',
    tryCloud: 'Ou experimente a versão em nuvem do Dify com cota gratuita',
  },
  overview: {
    title: 'Visão geral',
    appInfo: {
      explanation: 'Aplicativo Web de IA pronto para uso',
      accessibleAddress: 'URL pública',
      preview: 'Visualização',
      regenerate: 'Regenerar',
      preUseReminder: 'Ative o aplicativo da Web antes de continuar.',
      settings: {
        entry: 'Configurações',
        title: 'Configurações do aplicativo da Web',
        webName: 'Nome do aplicativo da Web',
        webDesc: 'Descrição do aplicativo da Web',
        webDescTip: 'Este texto será exibido no lado do cliente, fornecendo orientações básicas sobre como usar o aplicativo',
        webDescPlaceholder: 'Insira a descrição do aplicativo da Web',
        language: 'Idioma',
        more: {
          entry: 'Mostrar mais configurações',
          copyright: 'Direitos autorais',
          copyRightPlaceholder: 'Insira o nome do autor ou organização',
          privacyPolicy: 'Política de Privacidade',
          privacyPolicyPlaceholder: 'Insira o link da política de privacidade',
          privacyPolicyTip: 'Ajuda os visitantes a entender os dados que o aplicativo coleta, consulte a <privacyPolicyLink>Política de Privacidade</privacyPolicyLink> do Dify.',
        },
      },
      embedded: {
        entry: 'Embutido',
        title: 'Incorporar no site',
        explanation: 'Escolha a maneira de incorporar o aplicativo de bate-papo ao seu site',
        iframe: 'Para adicionar o aplicativo de bate-papo em qualquer lugar do seu site, adicione este iframe ao seu código HTML.',
        scripts: 'Para adicionar um aplicativo de bate-papo na parte inferior direita do seu site, adicione este código ao seu HTML.',
        chromePlugin: 'Instalar Extensão do Chatbot Dify para o Chrome',
        copied: 'Copiado',
        copy: 'Copiar',
      },
      qrcode: {
        title: 'Código QR para compartilhar',
        scan: 'Digitalizar para compartilhar o aplicativo',
        download: 'Baixar código QR',
      },
      customize: {
        way: 'maneira',
        entry: 'Personalizar',
        title: 'Personalizar aplicativo Web de IA',
        explanation: 'Você pode personalizar a interface do usuário do aplicativo Web para se adequar ao seu cenário e necessidades de estilo.',
        way1: {
          name: 'Fork do código do cliente, modifique-o e implante no Vercel (recomendado)',
          step1: 'Fork do código do cliente e modifique-o',
          step1Tip: 'Clique aqui para fazer um fork do código-fonte em sua conta do GitHub e modificar o código',
          step1Operation: 'Dify-WebClient',
          step2: 'Implantar no Vercel',
          step2Tip: 'Clique aqui para importar o repositório no Vercel e implantar',
          step2Operation: 'Importar repositório',
          step3: 'Configurar variáveis de ambiente',
          step3Tip: 'Adicione as seguintes variáveis de ambiente no Vercel',
        },
        way2: {
          name: 'Escrever código do lado do cliente para chamar a API e implantá-lo em um servidor',
          operation: 'Documentação',
        },
      },
    },
    apiInfo: {
      title: 'API do serviço de backend',
      explanation: 'Integração fácil em seu aplicativo',
      accessibleAddress: 'Endpoint da API de serviço',
      doc: 'Referência da API',
    },
    status: {
      running: 'Em serviço',
      disable: 'Desativar',
    },
  },
  analysis: {
    title: 'Análise',
    ms: 'ms',
    tokenPS: 'Token/s',
    totalMessages: {
      title: 'Total de mensagens',
      explanation: 'Contagem diária de interações de IA; engenharia de prompt/depuração excluída.',
    },
    activeUsers: {
      title: 'Usuários ativos',
      explanation: 'Usuários únicos envolvidos em perguntas e respostas com IA; engenharia de prompt/depuração excluída.',
    },
    tokenUsage: {
      title: 'Uso de tokens',
      explanation: 'Reflete o uso diário de tokens do modelo de linguagem para o aplicativo, útil para fins de controle de custos.',
      consumed: 'Consumidos',
    },
    avgSessionInteractions: {
      title: 'Média de interações por sessão',
      explanation: 'Contagem contínua de comunicação usuário-IA; para aplicativos baseados em conversas.',
    },
    userSatisfactionRate: {
      title: 'Taxa de satisfação do usuário',
      explanation: 'O número de curtidas por 1.000 mensagens. Isso indica a proporção de respostas com as quais os usuários estão altamente satisfeitos.',
    },
    avgResponseTime: {
      title: 'Tempo médio de resposta',
      explanation: 'Tempo (ms) para o processamento/resposta da IA; para aplicativos baseados em texto.',
    },
    tps: {
      title: 'Velocidade de saída de tokens',
      explanation: 'Mede o desempenho do LLM. Conta a velocidade de saída de tokens do LLM desde o início da solicitação até a conclusão da saída.',
    },
  },
}

export default translation
