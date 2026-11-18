"""Bundle Web field help and localized XLSX notices for the API-only runtime."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))

from constants.languages import languages  # noqa: E402

SOURCE_DIR = ROOT / "web" / "i18n" / "locales"
OUTPUT = ROOT / "api" / "services" / "evaluation_template_translations.json"
FIELD_HELP_KEYS = (
    "index",
    "input",
    "expectedOutput",
    "retrievalExpectedOutput",
    "successCriteria",
    "expectedToolCalls",
)

NOTICE_BY_LOCALE = {
    "en-US": "This row contains example explanations. Delete this row before uploading the dataset for evaluation.",
    "zh-Hans": "该行为示例说明请删除本行后进行上传评估。",
    "zh-Hant": "此行為範例說明，請刪除此行後再上傳進行評估。",
    "pt-BR": (
        "Esta linha contém explicações de exemplo. "
        "Exclua esta linha antes de enviar o conjunto de dados para avaliação."
    ),
    "es-ES": "Esta fila contiene explicaciones de ejemplo. Elimínala antes de subir los datos para su evaluación.",
    "fr-FR": (
        "Cette ligne contient des explications à titre d’exemple. "
        "Supprimez-la avant de téléverser le jeu de données pour l’évaluation."
    ),
    "de-DE": "Diese Zeile enthält Beispielerklärungen. Löschen Sie sie vor dem Hochladen zur Auswertung.",
    "ja-JP": "この行は入力例の説明です。評価用データセットをアップロードする前に、この行を削除してください。",
    "ko-KR": "이 행은 예시 설명입니다. 평가용 데이터셋을 업로드하기 전에 이 행을 삭제하세요.",
    "lo-LA": "ແຖວນີ້ແມ່ນຄຳອະທິບາຍຕົວຢ່າງ. ກະລຸນາລຶບແຖວນີ້ກ່ອນອັບໂຫຼດຊຸດຂໍ້ມູນເພື່ອປະເມີນ.",
    "ru-RU": "Эта строка содержит пояснения к примеру. Удалите её перед загрузкой набора данных для оценки.",
    "it-IT": "Questa riga contiene spiegazioni di esempio. Eliminala prima di caricare i dati per la valutazione.",
    "th-TH": "แถวนี้เป็นคำอธิบายตัวอย่าง โปรดลบแถวนี้ก่อนอัปโหลดชุดข้อมูลเพื่อประเมินผล",
    "uk-UA": "Цей рядок містить приклади пояснень. Видаліть його перед завантаженням набору даних для оцінювання.",
    "vi-VN": "Hàng này chứa phần giải thích mẫu. Hãy xóa hàng này trước khi tải bộ dữ liệu lên để đánh giá.",
    "ro-RO": "Acest rând conține explicații de exemplu. Ștergeți-l înainte de încărcarea datelor pentru evaluare.",
    "pl-PL": "Ten wiersz zawiera przykładowe objaśnienia. Usuń go przed przesłaniem zbioru danych do oceny.",
    "hi-IN": "इस पंक्ति में उदाहरण के रूप में स्पष्टीकरण दिए गए हैं। मूल्यांकन के लिए डेटा सेट अपलोड करने से पहले इस पंक्ति को हटा दें।",
    "tr-TR": "Bu satır örnek açıklamalar içerir. Veri kümesini değerlendirme için yüklemeden önce bu satırı silin.",
    "fa-IR": "این ردیف شامل توضیحات نمونه است. پیش از بارگذاری مجموعه‌داده برای ارزیابی، این ردیف را حذف کنید.",
    "sl-SI": "Ta vrstica vsebuje primer pojasnil. Pred nalaganjem nabora podatkov za vrednotenje jo izbrišite.",
    "id-ID": "Baris ini berisi penjelasan contoh. Hapus baris ini sebelum mengunggah set data untuk evaluasi.",
    "ar-TN": "يحتوي هذا الصف على شروحات توضيحية. احذف هذا الصف قبل رفع مجموعة البيانات للتقييم.",
    "nl-NL": "Deze rij bevat voorbeelduitleg. Verwijder deze rij voordat je de dataset uploadt voor evaluatie.",
    "az-AZ": "Bu sətirdə nümunə izahlar var. Məlumat dəstini qiymətləndirmə üçün yükləməzdən əvvəl bu sətri silin.",
}


def build_translations() -> dict[str, dict[str, str]]:
    """Read every supported Web locale and add its XLSX-only notice."""
    if set(NOTICE_BY_LOCALE) != set(languages):
        raise ValueError("The XLSX notice translations must cover every supported API language.")

    translations: dict[str, dict[str, str]] = {}
    for locale in languages:
        resource = json.loads((SOURCE_DIR / locale / "evaluation.json").read_text(encoding="utf-8"))
        translations[locale] = {
            **{key: resource[f"batch.fieldHelp.{key}"] for key in FIELD_HELP_KEYS},
            "notice": NOTICE_BY_LOCALE[locale],
        }
    return translations


def main() -> None:
    """Write the API bundle, or fail when the committed bundle is stale."""
    content = json.dumps(build_translations(), ensure_ascii=False, indent=2) + "\n"
    if "--check" in sys.argv:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != content:
            raise ValueError("Evaluation template translations are stale. Regenerate the API bundle.")
    else:
        OUTPUT.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()
