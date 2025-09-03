const translation = {
  welcome: {
    firstStepTip: 'Untuk memulai,',
    placeholder: 'Kunci API OpenAI Anda (misalnya.sk-xxxx)',
    enterKeyTip: 'masukkan Kunci API OpenAI Anda di bawah ini',
    getKeyTip: 'Dapatkan Kunci API Anda dari dasbor OpenAI',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        description: 'Kuota uji coba disediakan untuk tujuan pengujian Anda. Sebelum kuota uji coba habis, harap siapkan penyedia model Anda sendiri atau beli kuota tambahan.',
      },
      exhausted: {
        title: 'Kuota uji coba Anda telah habis, silakan atur APIKey Anda.',
        description: 'Anda telah menghabiskan kuota percobaan Anda. Silakan siapkan penyedia model Anda sendiri atau beli kuota tambahan.',
      },
    },
    selfHost: {
      title: {
        row1: 'Untuk memulai,',
        row2: 'Siapkan penyedia model Anda terlebih dahulu.',
      },
    },
    usedToken: 'Token bekas',
    callTimes: 'Waktu panggilan',
    tryCloud: 'Atau coba Dify versi cloud dengan penawaran gratis',
    setAPIBtn: 'Buka penyedia model penyiapan',
  },
  overview: {
    appInfo: {
      settings: {
        workflow: {
          hide: 'Menyembunyikan',
          subTitle: 'Detail Alur Kerja',
          showDesc: 'Menampilkan atau menyembunyikan detail alur kerja di aplikasi web',
          title: 'Alur Kerja',
          show: 'Memperlihatkan',
        },
        sso: {
          label: 'Penegakan SSO',
          tooltip: 'Hubungi administrator untuk mengaktifkan SSO aplikasi web',
          title: 'aplikasi web SSO',
          description: 'Semua pengguna diharuskan masuk dengan SSO sebelum menggunakan aplikasi web',
        },
        more: {
          customDisclaimerPlaceholder: 'Masukkan teks penafian khusus',
          copyrightTooltip: 'Silakan tingkatkan ke paket Profesional atau lebih tinggi',
          entry: 'Tampilkan setelan lainnya',
          copyRightPlaceholder: 'Masukkan nama penulis atau organisasi',
          copyrightTip: 'Menampilkan informasi hak cipta di aplikasi web',
          privacyPolicy: 'Kebijakan Privasi',
          customDisclaimer: 'Penafian Kustom',
          privacyPolicyPlaceholder: 'Masukkan tautan kebijakan privasi',
          customDisclaimerTip: 'Teks penafian khusus akan ditampilkan di sisi klien, memberikan informasi tambahan tentang aplikasi',
          copyright: 'Hak cipta',
        },
        chatColorThemeInverted: 'Terbalik',
        invalidPrivacyPolicy: 'Tautan kebijakan privasi tidak valid. Silakan gunakan tautan valid yang dimulai dengan http atau https',
        language: 'Bahasa',
        invalidHexMessage: 'Nilai hex tidak valid',
        webName: 'Nama aplikasi web',
        webDescPlaceholder: 'Masukkan deskripsi aplikasi web',
        chatColorThemeDesc: 'Atur tema warna chatbot',
        modalTip: 'Pengaturan aplikasi web sisi klien.',
        title: 'Pengaturan Aplikasi Web',
        webDescTip: 'Teks ini akan ditampilkan di sisi klien, memberikan panduan dasar tentang cara menggunakan aplikasi',
        entry: 'Pengaturan',
        chatColorTheme: 'Tema warna obrolan',
        webDesc: 'Deskripsi aplikasi web',
      },
      embedded: {
        copied: 'Disalin',
        title: 'Sematkan di situs web',
        entry: 'Tertanam',
        explanation: 'Pilih cara menyematkan aplikasi obrolan ke situs web Anda',
        copy: 'Menyalin',
        chromePlugin: 'Instal Ekstensi Chrome Dify Chatbot',
        iframe: 'Untuk menambahkan aplikasi obrolan di mana saja di situs web Anda, tambahkan iframe ini ke kode html Anda.',
        scripts: 'Untuk menambahkan aplikasi obrolan ke kanan bawah situs web Anda, tambahkan kode ini ke html Anda.',
      },
      qrcode: {
        scan: 'Pindai Untuk Berbagi',
        download: 'Unduh Kode QR',
        title: 'Tautan Kode QR',
      },
      customize: {
        way1: {
          step1Operation: 'Dify-WebClient',
          step2Operation: 'Impor repositori',
          step1: 'Fork kode klien dan modifikasi',
          step2Tip: 'Klik di sini untuk mengimpor repositori ke Vercel dan menyebarkan',
          step2: 'Terapkan ke Vercel',
          name: 'Fork kode klien, modifikasi dan terapkan ke Vercel (disarankan)',
          step3: 'Mengonfigurasi variabel lingkungan',
          step1Tip: 'Klik di sini untuk melakukan fork kode sumber ke akun GitHub Anda dan memodifikasi kode',
          step3Tip: 'Tambahkan variabel lingkungan berikut di Vercel',
        },
        way2: {
          operation: 'Dokumentasi',
          name: 'Tulis kode sisi klien untuk memanggil API dan menyebarkannya ke server',
        },
        way: 'jalan',
        entry: 'Menyesuaikan',
        title: 'Sesuaikan aplikasi web AI',
        explanation: 'Anda dapat menyesuaikan frontend Aplikasi Web agar sesuai dengan skenario dan kebutuhan gaya Anda.',
      },
      launch: 'Luncur',
      regenerate: 'Regenerasi',
      preview: 'Pratayang',
      accessibleAddress: 'URL publik',
      preUseReminder: 'Harap aktifkan aplikasi web sebelum melanjutkan.',
      regenerateNotice: 'Apakah Anda ingin membuat ulang URL publik?',
      explanation: 'Aplikasi web AI siap pakai',
    },
    apiInfo: {
      accessibleAddress: 'Titik Akhir API Layanan',
      title: 'API Layanan Backend',
      doc: 'Referensi API',
      explanation: 'Mudah diintegrasikan ke dalam aplikasi Anda',
    },
    status: {
      disable: 'Nonaktif',
      running: 'Berjalan',
    },
    title: 'Ikhtisar',
  },
  analysis: {
    totalMessages: {
      explanation: 'Interaksi AI harian diperhitungkan.',
      title: 'Total Pesan',
    },
    totalConversations: {
      title: 'Total Percakapan',
      explanation: 'Percakapan AI harian diperhitungkan; Pengecualian rekayasa/debugging prompt.',
    },
    activeUsers: {
      explanation: 'Pengguna unik yang terlibat dalam Tanya Jawab dengan AI; Pengecualian rekayasa/debugging prompt.',
      title: 'Pengguna Aktif',
    },
    tokenUsage: {
      title: 'Penggunaan Token',
      explanation: 'Mencerminkan penggunaan token harian dari model bahasa untuk aplikasi, berguna untuk tujuan pengendalian biaya.',
      consumed: 'Dikonsumsi',
    },
    avgSessionInteractions: {
      title: 'Interaksi Sesi Rata-rata',
      explanation: 'Jumlah komunikasi pengguna-AI yang berkelanjutan; untuk aplikasi berbasis percakapan.',
    },
    avgUserInteractions: {
      explanation: 'Mencerminkan frekuensi penggunaan harian pengguna. Metrik ini mencerminkan kelengketan pengguna.',
      title: 'Rata-rata Interaksi Pengguna',
    },
    userSatisfactionRate: {
      title: 'Tingkat Kepuasan Pengguna',
      explanation: 'Jumlah suka per 1.000 pesan. Ini menunjukkan proporsi jawaban yang sangat dipuaskan pengguna.',
    },
    avgResponseTime: {
      explanation: 'Waktu (ms) bagi AI untuk memproses/merespons; untuk aplikasi berbasis teks.',
      title: 'Rata-rata Waktu Respons',
    },
    tps: {
      title: 'Kecepatan Keluaran Token',
      explanation: 'Mengukur kinerja LLM. Hitung kecepatan keluaran Token LLM dari awal permintaan hingga penyelesaian output.',
    },
    tokenPS: 'Token',
    title: 'Analisis',
    ms: 'Ms',
  },
}

export default translation
