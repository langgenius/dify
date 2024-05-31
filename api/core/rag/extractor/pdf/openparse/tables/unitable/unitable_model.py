import warnings
from functools import partial
from pathlib import Path
from typing import Union

import tokenizers as tk  # type: ignore
import torch  # type: ignore
from torch import nn

from core.rag.extractor.pdf.openparse.config import config as global_config

from .config import config
from .tabular_transformer import (
    Decoder,
    Encoder,
    EncoderDecoder,
    ImgLinearBackbone,
)

device = global_config.get_device()
warnings.filterwarnings("ignore")


def load_vocab_and_model(
    vocab_path: Union[str, Path],
    max_seq_len: int,
    model_weights: Union[str, Path],
) -> tuple[tk.Tokenizer, EncoderDecoder]:
    backbone = ImgLinearBackbone(d_model=config.d_model, patch_size=config.patch_size)
    encoder = Encoder(
        d_model=config.d_model,
        nhead=config.nhead,
        dropout=config.dropout,
        activation="gelu",
        norm_first=True,
        nlayer=12,
        ff_ratio=4,
    )
    decoder = Decoder(
        d_model=config.d_model,
        nhead=config.nhead,
        dropout=config.dropout,
        activation="gelu",
        norm_first=True,
        nlayer=4,
        ff_ratio=4,
    )

    vocab = tk.Tokenizer.from_file(str(vocab_path))
    model = EncoderDecoder(
        backbone=backbone,
        encoder=encoder,
        decoder=decoder,
        vocab_size=vocab.get_vocab_size(),
        d_model=config.d_model,
        padding_idx=vocab.token_to_id("<pad>"),
        max_seq_len=max_seq_len,
        dropout=config.dropout,
        norm_layer=partial(nn.LayerNorm, eps=1e-6),
    )

    model.load_state_dict(torch.load(model_weights, map_location="cpu"))
    model = model.to(device)
    return vocab, model


structure_vocab, structure_model = load_vocab_and_model(
    vocab_path=config.structure.vocab_path,
    max_seq_len=config.structure.max_seq_len,
    model_weights=config.structure.weights_path,
)


bbox_vocab, bbox_model = load_vocab_and_model(
    vocab_path=config.bbox.vocab_path,
    max_seq_len=config.bbox.max_seq_len,
    model_weights=config.bbox.weights_path,
)

cell_vocab, cell_model = load_vocab_and_model(
    vocab_path=config.content.vocab_path,
    max_seq_len=config.content.max_seq_len,
    model_weights=config.content.weights_path,
)

print("Finished loading models. Ready for inference.")
