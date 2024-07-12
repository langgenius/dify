const translation = {
  knowledge: 'Conocimiento',
  documentCount: ' documentos',
  wordCount: ' mil palabras',
  appCount: ' aplicaciones vinculadas',
  createDataset: 'Crear Conocimiento',
  createDatasetIntro: 'Importa tus propios datos de texto o escribe datos en tiempo real a través de Webhook para mejorar el contexto de LLM.',
  deleteDatasetConfirmTitle: '¿Eliminar este Conocimiento?',
  deleteDatasetConfirmContent:
    'Eliminar el Conocimiento es irreversible. Los usuarios ya no podrán acceder a tu Conocimiento y todas las configuraciones y registros de las sugerencias se eliminarán permanentemente.',
  datasetUsedByApp: 'El conocimiento está siendo utilizado por algunas aplicaciones. Las aplicaciones ya no podrán utilizar este Conocimiento y todas las configuraciones y registros de las sugerencias se eliminarán permanentemente.',
  datasetDeleted: 'Conocimiento eliminado',
  datasetDeleteFailed: 'Error al eliminar el Conocimiento',
  didYouKnow: '¿Sabías?',
  intro1: 'El Conocimiento se puede integrar en la aplicación Dify ',
  intro2: 'como contexto',
  intro3: ',',
  intro4: 'o ',
  intro5: 'se puede crear',
  intro6: ' como un complemento independiente de ChatGPT para publicar',
  unavailable: 'No disponible',
  unavailableTip: 'El modelo de incrustación no está disponible, es necesario configurar el modelo de incrustación predeterminado',
  datasets: 'CONOCIMIENTO',
  datasetsApi: 'ACCESO A LA API',
  retrieval: {
    semantic_search: {
      title: 'Búsqueda Vectorial',
      description: 'Genera incrustaciones de consulta y busca el fragmento de texto más similar a su representación vectorial.',
    },
    full_text_search: {
      title: 'Búsqueda de Texto Completo',
      description: 'Indexa todos los términos del documento, lo que permite a los usuarios buscar cualquier término y recuperar el fragmento de texto relevante que contiene esos términos.',
    },
    hybrid_search: {
      title: 'Búsqueda Híbrida',
      description: 'Ejecuta búsquedas de texto completo y búsquedas vectoriales simultáneamente, reordena para seleccionar la mejor coincidencia para la consulta del usuario. Es necesaria la configuración de las API del modelo de reordenamiento.',
      recommend: 'Recomendar',
    },
    invertedIndex: {
      title: 'Índice Invertido',
      description: 'El Índice Invertido es una estructura utilizada para la recuperación eficiente. Organizado por términos, cada término apunta a documentos o páginas web que lo contienen.',
    },
    change: 'Cambiar',
    changeRetrievalMethod: 'Cambiar método de recuperación',
  },
  docsFailedNotice: 'no se pudieron indexar los documentos',
  retry: 'Reintentar',
}

export default translation
