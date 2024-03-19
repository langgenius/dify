const translation = {
  title: 'Journaux',
  description: 'Les journaux enregistrent l\'état de fonctionnement de l\'application, y compris les entrées de l\'utilisateur et les réponses de l\'IA.',
  dateTimeFormat: 'JJ/MM/AAAA hh:mm A',
  table: {
    header: {
      time: 'Temps',
      endUser: 'Utilisateur final',
      input: 'Entrée',
      output: 'Sortie',
      summary: 'Titre',
      messageCount: 'Nombre de Messages',
      userRate: 'Taux d\'utilisateur',
      adminRate: 'Taux Op.',
    },
    pagination: {
      previous: 'Précédent',
      next: 'Suivant',
    },
    empty: {
      noChat: 'Aucune conversation pour le moment',
      noOutput: 'Aucune sortie',
      element: {
        title: 'Quelqu\'un est là ?',
        content: 'Observez et annotez les interactions entre les utilisateurs finaux et les applications IA ici pour améliorer continuellement la précision de l\'IA. Vous pouvez essayer de <shareLink>partager</shareLink> ou de <testLink>tester</testLink> l\'application Web',
      },
    },
  },
  detail: {
    time: 'Temps',
    conversationId: 'ID de conversation',
    promptTemplate: 'Modèle de Prompt',
    promptTemplateBeforeChat: 'Modèle de Prompt Avant le Chat · En Tant que Message Système',
    annotationTip: 'Améliorations Marquées par {{user}}',
    timeConsuming: 'Apologies, but you haven\'t provided any text to translate. Could you please provide the text so I can help you with the translation?',
    second: '"s"',
    tokenCost: 'Jeton dépensé',
    loading: 'chargement',
    operation: {
      like: 'comme',
      dislike: 'déteste',
      addAnnotation: 'Ajouter une amélioration',
      editAnnotation: 'Amélioration de l\'édition',
      annotationPlaceholder: 'Entrez la réponse attendue que vous souhaitez que l\'IA donne, qui peut être utilisée pour l\'ajustement fin du modèle et l\'amélioration continue de la qualité de génération de texte à l\'avenir.',
    },
    variables: 'Variables',
    uploadImages: 'Images Téléchargées',
  },
  filter: {
    period: {
      today: 'Aujourd\'hui',
      last7days: 'Les 7 Derniers Jours',
      last4weeks: 'Les 4 dernières semaines',
      last3months: 'Les 3 derniers mois',
      last12months: 'Les 12 derniers mois',
      monthToDate: 'Mois à ce jour',
      quarterToDate: 'Trimestre à ce jour',
      yearToDate: 'Année à ce jour',
      allTime: 'Tout le temps',
    },
    annotation: {
      all: 'Tout',
      annotated: 'Améliorations annotées ({{count}} éléments)',
      not_annotated: 'Non Annoté',
    },
  },
}

export default translation
