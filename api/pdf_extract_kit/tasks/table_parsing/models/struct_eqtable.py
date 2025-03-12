import torch

from PIL import Image
from struct_eqtable import build_model
from pdf_extract_kit.registry.registry import MODEL_REGISTRY


@MODEL_REGISTRY.register("table_parsing_struct_eqtable")
class TableParsingStructEqTable:
    def __init__(self, config):
        """
        Initialize the TableParsingStructEqTable class.

        Args:
            config (dict): Configuration dictionary containing model parameters.
        """
        assert torch.cuda.is_available(), "CUDA must be available for StructEqTable model."

        self.model_dir = config.get('model_path', 'U4R/StructTable-InternVL2-1B')
        self.max_new_tokens = config.get('max_new_tokens', 1024)
        self.max_time = config.get('max_time', 30)

        self.lmdeploy = config.get('lmdeploy', False)
        self.flash_attn = config.get('flash_attn', True)
        self.batch_size = config.get('batch_size', 1)
        self.default_format = config.get('output_format', 'latex')

        # Load the StructEqTable model
        self.model = build_model(
            model_ckpt=self.model_dir,
            max_new_tokens=self.max_new_tokens,
            max_time=self.max_time,
            lmdeploy=self.lmdeploy,
            flash_attn=self.flash_attn,
            batch_size=self.batch_size,
        ).cuda()

    def predict(self, images, result_path, output_format=None, **kwargs):        

        load_images = [Image.open(image_path) for image_path in images]

        if output_format is None:
            output_format = self.default_format
        else:
            if output_format not in ['latex', 'markdown', 'html']:
                raise ValueError(f"Output format {output_format} is not supported.")

        results = self.model(
            load_images, output_format=output_format
        )

        return results
