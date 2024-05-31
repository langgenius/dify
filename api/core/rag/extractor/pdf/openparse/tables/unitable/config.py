import sys
from pathlib import Path

from pydantic import BaseModel

from core.rag.extractor.pdf.openparse import consts

root = Path(consts.__file__).parent


class StructureModelConfig(BaseModel):
    weights_path: Path = root / "weights/unitable/unitable_large_structure.pt"
    vocab_path: Path = root / "weights/unitable/vocab_html.json"
    max_seq_len: int = 784


class BboxModelConfig(BaseModel):
    weights_path: Path = root / "weights/unitable/unitable_large_bbox.pt"
    vocab_path: Path = root / "weights/unitable/vocab_bbox.json"

    max_seq_len: int = 1024


class ContentModelConfig(BaseModel):
    weights_path: Path = root / "weights/unitable/unitable_large_content.pt"
    vocab_path: Path = root / "weights/unitable/vocab_cell_6k.json"
    max_seq_len: int = 200


class UniTableConfig(BaseModel):
    d_model: int = 768
    patch_size: int = 16
    nhead: int = 12
    dropout: float = 0.2

    structure: StructureModelConfig = StructureModelConfig()
    bbox: BboxModelConfig = BboxModelConfig()
    content: ContentModelConfig = ContentModelConfig()

    def validate_weight_files_exist(self):
        weight_paths = [
            self.structure.weights_path,
            self.bbox.weights_path,
            self.content.weights_path,
            self.structure.vocab_path,
            self.bbox.vocab_path,
            self.content.vocab_path,
        ]

        missing_files = [path for path in weight_paths if not path.exists()]

        if missing_files:
            print("Error: The following weight files are missing:", file=sys.stderr)
            for missing in missing_files:
                print(f"- {missing}", file=sys.stderr)

            raise RuntimeError(
                "Missing weights files. Have you ran `openparse-download` to download the weights?"
            )


config = UniTableConfig()
config.validate_weight_files_exist()
