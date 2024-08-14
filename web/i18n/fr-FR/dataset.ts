const translation = {
  knowledge: 'Connaissance',
  documentCount: ' documents',
  wordCount: ' k mots',
  appCount: ' applications liées',
  createDataset: 'Créer des Connaissances',
  createDatasetIntro: 'Importez vos propres données textuelles ou écrivez des données en temps réel via Webhook pour l\'amélioration du contexte LLM.',
  deleteDatasetConfirmTitle: 'Supprimer cette Connaissance ?',
  deleteDatasetConfirmContent:
    'La suppression de la Connaissance est irréversible. Les utilisateurs ne pourront plus accéder à votre Savoir, et toutes les configurations de prompt et les journaux seront supprimés de façon permanente.',
  datasetUsedByApp: 'La connaissance est utilisée par certaines applications. Les applications ne pourront plus utiliser cette Connaissance, et toutes les configurations de prompts et les journaux seront définitivement supprimés.',
  datasetDeleted: 'Connaissance supprimée',
  datasetDeleteFailed: 'Échec de la suppression de la Connaissance',
  didYouKnow: 'Saviez-vous ?',
  intro1: 'La Connaissance peut être intégrée dans l\'application Dify',
  intro2: 'comme un contexte',
  intro3: ',',
  intro4: 'ou ça ',
  intro5: 'peut être créé',
  intro6: 'comme un plug-in d\'index ChatGPT autonome à publier',
  unavailable: 'Indisponible',
  unavailableTip: 'Le modèle d\'embedding n\'est pas disponible, le modèle d\'embedding par défaut doit être configuré',
  datasets: 'CONNAISSANCE',
  datasetsApi: 'API',
  retrieval: {
    semantic_search: {
      title: 'Recherche Vectorielle',
      description: 'Générez des embeddings de requête et recherchez le morceau de texte le plus similaire à sa représentation vectorielle.',
    },
    full_text_search: {
      title: 'Recherche en Texte Intégral',
      description: 'Indexez tous les termes dans le document, permettant aux utilisateurs de rechercher n\'importe quel terme et de récupérer le fragment de texte pertinent contenant ces termes.',
    },
    hybrid_search: {
      title: 'Recherche Hybride',
      description: 'Exécutez une recherche en texte intégral et des recherches vectorielles en même temps, réorganisez pour sélectionner la meilleure correspondance pour la requête de l\'utilisateur. La configuration de l\'API du modèle de réorganisation est nécessaire.',
      recommend: 'Recommander',
    },
    invertedIndex: {
      title: 'Index inversé',
      description: 'L\'Index inversé est une structure utilisée pour une récupération efficace. Organisé par termes, chaque terme pointe vers des documents ou des pages web le contenant.',
    },
    change: 'Changer',
    changeRetrievalMethod: 'Changer la méthode de récupération',
  },
  docsFailedNotice: 'Les documents n\'ont pas pu être indexés',
  retry: 'Réessayer',
}

export default translation
