const translation = {
  creation: {
    createFromScratch: {
      title: 'Alur pengetahuan kosong',
      description: 'Buat alur kustom dari awal dengan kontrol penuh atas pemrosesan dan struktur data.',
    },
    caution: 'Hati',
    createKnowledge: 'Ciptakan Pengetahuan',
    errorTip: 'Gagal membuat Basis Pengetahuan',
    backToKnowledge: 'Kembali ke Pengetahuan',
    successTip: 'Berhasil membuat Basis Pengetahuan',
    importDSL: 'Mengimpor dari file DSL',
  },
  templates: {
    customized: 'Disesuaikan',
  },
  operations: {
    choose: 'Memilih',
    convert: 'Mengkonversi',
    preview: 'Pratayang',
    saveAndProcess: 'Simpan & Proses',
    process: 'Proses',
    details: 'Rincian',
    backToDataSource: 'Kembali ke Sumber Data',
    editInfo: 'Edit info',
    dataSource: 'Sumber Data',
    exportPipeline: 'Pipa Ekspor',
    useTemplate: 'Gunakan Alur Pengetahuan ini',
  },
  deletePipeline: {
    title: 'Apakah Anda yakin akan menghapus templat alur ini?',
    content: 'Menghapus templat alur tidak dapat diubah.',
  },
  publishPipeline: {
    success: {
      message: 'Alur Pengetahuan Diterbitkan',
    },
    error: {
      message: 'Gagal Menerbitkan Alur Pengetahuan',
    },
  },
  publishTemplate: {
    success: {
      learnMore: 'Pelajari lebih lanjut',
      message: 'Templat Alur Diterbitkan',
      tip: 'Anda dapat menggunakan template ini di halaman pembuatan.',
    },
    error: {
      message: 'Gagal menerbitkan templat alur',
    },
  },
  exportDSL: {
    successTip: 'Ekspor DSL pipeline berhasil',
    errorTip: 'Gagal mengekspor DSL alur',
  },
  details: {
    structure: 'Struktur',
    structureTooltip: 'Struktur Potongan menentukan bagaimana dokumen dibagi dan diindeks—menawarkan mode Umum, Induk-Anak, dan Tanya Jawab—dan unik untuk setiap basis pengetahuan.',
  },
  testRun: {
    steps: {
      documentProcessing: 'Pemrosesan Dokumen',
      dataSource: 'Sumber Data',
    },
    dataSource: {
      localFiles: 'File Lokal',
    },
    notion: {
      docTitle: 'Dokumen gagasan',
      title: 'Pilih Halaman Notion',
    },
    title: 'Uji Coba',
    tooltip: 'Dalam mode uji coba, hanya satu dokumen yang diizinkan untuk diimpor pada satu waktu untuk penelusuran kesalahan dan pengamatan yang lebih mudah.',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: 'Input Unik untuk Setiap Pintu Masuk',
      tooltip: 'Input Unik hanya dapat diakses oleh sumber data yang dipilih dan simpul hilirnya. Pengguna tidak perlu mengisinya saat memilih sumber data lain. Hanya bidang input yang direferensikan oleh variabel sumber data yang akan muncul di langkah pertama (Sumber Data). Semua bidang lainnya akan ditampilkan pada langkah kedua (Proses Dokumen).',
    },
    globalInputs: {
      title: 'Input Global untuk Semua Pintu Masuk',
      tooltip: 'Input Global dibagikan di semua simpul. Pengguna harus mengisinya saat memilih sumber data apa pun. Misalnya, bidang seperti pembatas dan panjang potongan maksimum dapat diterapkan secara seragam di beberapa sumber data. Hanya bidang input yang direferensikan oleh variabel Sumber Data yang muncul di langkah pertama (Sumber Data). Semua bidang lainnya muncul di langkah kedua (Proses Dokumen).',
    },
    preview: {
      stepTwoTitle: 'Dokumen Proses',
      stepOneTitle: 'Sumber Data',
    },
    error: {
      variableDuplicate: 'Nama variabel sudah ada. Silakan pilih nama yang berbeda.',
    },
    title: 'Bidang Input Pengguna',
    editInputField: 'Edit Bidang Input',
    addInputField: 'Tambahkan Bidang Input',
    description: 'Bidang input pengguna digunakan untuk menentukan dan mengumpulkan variabel yang diperlukan selama proses eksekusi alur. Pengguna dapat menyesuaikan jenis bidang dan mengonfigurasi nilai input secara fleksibel untuk memenuhi kebutuhan sumber data atau langkah pemrosesan dokumen yang berbeda.',
  },
  addDocuments: {
    steps: {
      processDocuments: 'Dokumen Proses',
      processingDocuments: 'Memproses Dokumen',
      chooseDatasource: 'Pilih Sumber Data',
    },
    stepOne: {
      preview: 'Pratayang',
    },
    stepTwo: {
      chunkSettings: 'Pengaturan Potongan',
      previewChunks: 'Pratinjau Potongan',
    },
    stepThree: {
      learnMore: 'Pelajari lebih lanjut',
    },
    title: 'Tambahkan Dokumen',
    backToDataSource: 'Sumber Data',
    characters: 'Karakter',
  },
  documentSettings: {
    title: 'Pengaturan Dokumen',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      allFiles: 'Semua File',
      allBuckets: 'Semua Bucket Penyimpanan Cloud',
      searchPlaceholder: 'Cari file...',
    },
    resetKeywords: 'Mengatur ulang kata kunci',
    notSupportedFileType: 'Jenis file ini tidak didukung',
    emptySearchResult: 'Tidak ada barang yang ditemukan',
    emptyFolder: 'Folder ini kosong',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      title: 'Konfirmasi',
      content: 'Tindakan ini bersifat permanen. Anda tidak akan dapat kembali ke metode sebelumnya. Silakan konfirmasi untuk mengonversi.',
    },
    warning: 'Tindakan ini tidak dapat dibatalkan.',
    descriptionChunk2: '— pendekatan yang lebih terbuka dan fleksibel dengan akses ke plugin dari pasar kami. Ini akan menerapkan metode pemrosesan baru untuk semua dokumen di masa mendatang.',
    successMessage: 'Berhasil mengonversi himpunan data menjadi alur',
    errorMessage: 'Gagal mengonversi himpunan data ke alur',
    descriptionChunk1: 'Anda sekarang dapat mengonversi basis pengetahuan yang ada untuk menggunakan Knowledge Pipeline untuk pemrosesan dokumen',
    title: 'Mengonversi ke Alur Pengetahuan',
  },
  knowledgePermissions: 'Izin',
  pipelineNameAndIcon: 'Nama & ikon pipa',
  inputField: 'Bidang Masukan',
  knowledgeDescription: 'Deskripsi pengetahuan',
  knowledgeNameAndIconPlaceholder: 'Silakan masukkan nama Basis Pengetahuan',
  knowledgeNameAndIcon: 'Nama & ikon pengetahuan',
  knowledgeDescriptionPlaceholder: 'Jelaskan apa yang ada di Basis Pengetahuan ini. Deskripsi terperinci memungkinkan AI mengakses konten kumpulan data dengan lebih akurat. Jika kosong, Dify akan menggunakan strategi hit default. (Opsional)',
  editPipelineInfo: 'Mengedit info alur',
}

export default translation
