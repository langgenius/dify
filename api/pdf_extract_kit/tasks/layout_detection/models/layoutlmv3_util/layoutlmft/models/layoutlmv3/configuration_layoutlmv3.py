# coding=utf-8
from transformers.models.bert.configuration_bert import BertConfig
from transformers.utils import logging


logger = logging.get_logger(__name__)

LAYOUTLMV3_PRETRAINED_CONFIG_ARCHIVE_MAP = {
    "layoutlmv3-base": "https://huggingface.co/microsoft/layoutlmv3-base/resolve/main/config.json",
    "layoutlmv3-large": "https://huggingface.co/microsoft/layoutlmv3-large/resolve/main/config.json",
    # See all LayoutLMv3 models at https://huggingface.co/models?filter=layoutlmv3
}


class LayoutLMv3Config(BertConfig):
    model_type = "layoutlmv3"

    def __init__(
        self,
        pad_token_id=1,
        bos_token_id=0,
        eos_token_id=2,
        max_2d_position_embeddings=1024,
        coordinate_size=None,
        shape_size=None,
        has_relative_attention_bias=False,
        rel_pos_bins=32,
        max_rel_pos=128,
        has_spatial_attention_bias=False,
        rel_2d_pos_bins=64,
        max_rel_2d_pos=256,
        visual_embed=True,
        mim=False,
        wpa_task=False,
        discrete_vae_weight_path='',
        discrete_vae_type='dall-e',
        input_size=224,
        second_input_size=112,
        device='cuda',
        **kwargs
    ):
        """Constructs RobertaConfig."""
        super().__init__(pad_token_id=pad_token_id, bos_token_id=bos_token_id, eos_token_id=eos_token_id, **kwargs)
        self.max_2d_position_embeddings = max_2d_position_embeddings
        self.coordinate_size = coordinate_size
        self.shape_size = shape_size
        self.has_relative_attention_bias = has_relative_attention_bias
        self.rel_pos_bins = rel_pos_bins
        self.max_rel_pos = max_rel_pos
        self.has_spatial_attention_bias = has_spatial_attention_bias
        self.rel_2d_pos_bins = rel_2d_pos_bins
        self.max_rel_2d_pos = max_rel_2d_pos
        self.visual_embed = visual_embed
        self.mim = mim
        self.wpa_task = wpa_task
        self.discrete_vae_weight_path = discrete_vae_weight_path
        self.discrete_vae_type = discrete_vae_type
        self.input_size = input_size
        self.second_input_size = second_input_size
        self.device = device
