const translation = {
  title: 'Registros',
  description: 'Os registros registram o status de execução do aplicativo, incluindo as entradas do usuário e as respostas da IA.',
  dateTimeFormat: 'MM/DD/YYYY hh:mm A',
  table: {
    header: {
      time: 'Tempo',
      endUser: 'Usuário Final',
      input: 'Entrada',
      output: 'Saída',
      summary: 'Título',
      messageCount: 'Contagem de Mensagens',
      userRate: 'Taxa de Usuário',
      adminRate: 'Taxa de Op.',
    },
    pagination: {
      previous: 'Anterior',
      next: 'Próximo',
    },
    empty: {
      noChat: 'Nenhuma conversa ainda',
      noOutput: 'Nenhuma saída',
      element: {
        title: 'Tem alguém aí?',
        content: 'Observe e anote as interações entre usuários finais e aplicativos de IA aqui para melhorar continuamente a precisão da IA. Você pode tentar <shareLink>compartilhar</shareLink> ou <testLink>testar</testLink> o aplicativo da Web você mesmo e depois voltar para esta página.',
      },
    },
  },
  detail: {
    time: 'Tempo',
    conversationId: 'ID da Conversa',
    promptTemplate: 'Modelo de Prompt',
    promptTemplateBeforeChat: 'Modelo de Prompt Antes da Conversa · Como Mensagem do Sistema',
    annotationTip: 'Melhorias Marcadas por {{user}}',
    timeConsuming: '',
    second: 's',
    tokenCost: 'Tokens gastos',
    loading: 'carregando',
    operation: {
      like: 'curtir',
      dislike: 'não curtir',
      addAnnotation: 'Adicionar Melhoria',
      editAnnotation: 'Editar Melhoria',
      annotationPlaceholder: 'Digite a resposta esperada que você deseja que a IA responda, que pode ser usada para ajustar o modelo e melhorar continuamente a qualidade da geração de texto no futuro.',
    },
    variables: 'Variáveis',
    uploadImages: 'Imagens Enviadas',
  },
  filter: {
    period: {
      today: 'Hoje',
      last7days: 'Últimos 7 Dias',
      last4weeks: 'Últimas 4 semanas',
      last3months: 'Últimos 3 meses',
      last12months: 'Últimos 12 meses',
      monthToDate: 'Mês até a data',
      quarterToDate: 'Trimestre até a data',
      yearToDate: 'Ano até a data',
      allTime: 'Todo o tempo',
    },
    annotation: {
      all: 'Todos',
      annotated: 'Melhorias Anotadas ({{count}} itens)',
      not_annotated: 'Não Anotadas',
    },
  },
}

export default translation
