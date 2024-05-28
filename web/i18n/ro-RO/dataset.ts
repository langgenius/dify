const translation = {
  knowledge: 'Cunoștințe',
  documentCount: ' documente',
  wordCount: ' mii de cuvinte',
  appCount: ' aplicații conectate',
  createDataset: 'Creează Cunoștințe',
  createDatasetIntro: 'Importați-vă propriile date text sau scrieți date în timp real prin Webhook pentru îmbunătățirea contextului LLM.',
  deleteDatasetConfirmTitle: 'Ștergeți această Cunoștință?',
  deleteDatasetConfirmContent:
    'Ștergerea Cunoștințelor este ireversibilă. Utilizatorii nu vor mai putea accesa Cunoștințele, iar toate configurațiile și jurnalele prompt vor fi șterse permanent.',
  datasetDeleted: 'Cunoștințe șterse',
  datasetDeleteFailed: 'Eșec la ștergerea Cunoștințelor',
  didYouKnow: 'Știați că?',
  intro1: 'Cunoștințele pot fi integrate în aplicația Dify ',
  intro2: 'ca un context',
  intro3: ',',
  intro4: 'sau ele ',
  intro5: 'pot fi create',
  intro6: ' ca un plug-in index ChatGPT standalone pentru publicare',
  unavailable: 'Indisponibil',
  unavailableTip: 'Modelul de încorporare nu este disponibil, modelul de încorporare implicit trebuie configurat',
  datasets: 'CUNOȘTINȚE',
  datasetsApi: 'ACCES API',
  retrieval: {
    semantic_search: {
      title: 'Căutare Vector',
      description: 'Generați încorporările interogărilor și căutați bucata de text cea mai similară cu reprezentarea sa vectorială.',
    },
    full_text_search: {
      title: 'Căutare Full-Text',
      description: 'Indexați toți termenii din document, permițând utilizatorilor să caute orice termen și să recupereze bucățile de text relevante care conțin acei termeni.',
    },
    hybrid_search: {
      title: 'Căutare Hibridă',
      description: 'Executați căutări full-text și căutări vectoriale în același timp, reclasificați pentru a selecta cea mai bună potrivire pentru interogarea utilizatorului. Configurarea API-ului modelului Rerank este necesară.',
      recommend: 'Recomandat',
    },
    invertedIndex: {
      title: 'Index Inversat',
      description: 'Indexul inversat este o structură utilizată pentru recuperare eficientă. Organizat după termeni, fiecare termen indică documentele sau paginile web care îl conțin.',
    },
    change: 'Schimbă',
    changeRetrievalMethod: 'Schimbă metoda de recuperare',
  },
  docsFailedNotice: 'documentele nu au putut fi indexate',
  retry: 'Reîncercați',
}

export default translation
