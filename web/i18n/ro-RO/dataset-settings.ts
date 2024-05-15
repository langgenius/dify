const translation = {
  title: 'Setări de cunoștințe',
  desc: 'Aici puteți modifica proprietățile și metodele de lucru ale cunoștințelor.',
  form: {
    name: 'Numele cunoștințelor',
    namePlaceholder: 'Vă rugăm să introduceți numele cunoștințelor',
    nameError: 'Numele nu poate fi gol',
    desc: 'Descrierea cunoștințelor',
    descInfo: 'Vă rugăm să scrieți o descriere textuală clară pentru a contura conținutul cunoștințelor. Această descriere va fi utilizată ca bază pentru potrivire atunci când se selectează din mai multe cunoștințe pentru inferență.',
    descPlaceholder: 'Descrieți ce se află în aceste cunoștințe. O descriere detaliată permite AI să acceseze conținutul cunoștințelor într-un timp oportun. Dacă este gol, Dify va folosi strategia implicită.',
    descWrite: 'Aflați cum să scrieți o descriere bună a cunoștințelor.',
    permissions: 'Permisiuni',
    permissionsOnlyMe: 'Doar eu',
    permissionsAllMember: 'Toți membrii echipei',
    indexMethod: 'Metodă de indexare',
    indexMethodHighQuality: 'Calitate ridicată',
    indexMethodHighQualityTip: 'Apelați interfața de încorporare a OpenAI pentru procesare pentru a oferi o acuratețe mai ridicată atunci când utilizatorii interogă.',
    indexMethodEconomy: 'Economică',
    indexMethodEconomyTip: 'Utilizați motoare de vectori offline, indexuri de cuvinte cheie etc. pentru a reduce acuratețea fără a cheltui jetoane',
    embeddingModel: 'Model de încorporare',
    embeddingModelTip: 'Schimbați modelul încorporat, vă rugăm să accesați ',
    embeddingModelTipLink: 'Setări',
    retrievalSetting: {
      title: 'Setări de recuperare',
      learnMore: 'Aflați mai multe',
      description: ' despre metoda de recuperare.',
      longDescription: ' despre metoda de recuperare, o puteți schimba în orice moment în setările cunoștințelor.',
    },
    save: 'Salvare',
  },
}

export default translation
