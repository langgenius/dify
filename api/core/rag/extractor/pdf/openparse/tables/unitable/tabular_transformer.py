from functools import partial

import torch
from torch import Tensor, nn


class TokenEmbedding(nn.Module):
    def __init__(
        self,
        vocab_size: int,
        d_model: int,
        padding_idx: int,
    ) -> None:
        super().__init__()
        assert vocab_size > 0
        self.embedding = nn.Embedding(vocab_size, d_model, padding_idx=padding_idx)

    def forward(self, x: Tensor) -> Tensor:
        return self.embedding(x)


class PositionEmbedding(nn.Module):
    def __init__(self, max_seq_len: int, d_model: int, dropout: float) -> None:
        super().__init__()
        self.embedding = nn.Embedding(max_seq_len, d_model)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: Tensor) -> Tensor:
        # assume x is batch first
        out = self.embedding(torch.arange(x.shape[1], device=x.device))
        return self.dropout(out + x)


class ImgLinearBackbone(nn.Module):
    def __init__(
        self,
        d_model: int,
        patch_size: int,
        in_chan: int = 3,
    ) -> None:
        super().__init__()

        self.conv_proj = nn.Conv2d(
            in_chan, out_channels=d_model, kernel_size=patch_size, stride=patch_size
        )
        self.d_model = d_model

    def forward(self, x: Tensor) -> Tensor:
        x = self.conv_proj(x)
        x = x.flatten(start_dim=-2).transpose(1, 2)
        return x


class Encoder(nn.Module):
    def __init__(
        self,
        d_model: int,
        nhead: int,
        dropout: float,
        activation: str,
        norm_first: bool,
        nlayer: int,
        ff_ratio: int = 4,
    ) -> None:
        super().__init__()

        encoder_layer = nn.TransformerEncoderLayer(
            d_model,
            nhead=nhead,
            dim_feedforward=ff_ratio * d_model,
            dropout=dropout,
            activation=activation,
            batch_first=True,
            norm_first=norm_first,
        )

        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=nlayer)

    def forward(self, x: Tensor) -> Tensor:
        x = self.encoder(x)
        return x


class Decoder(nn.Module):
    def __init__(
        self,
        d_model: int,
        nhead: int,
        dropout: float,
        activation: str,
        norm_first: bool,
        nlayer: int,
        ff_ratio: int = 4,
    ) -> None:
        super().__init__()
        decoder_layer = nn.TransformerDecoderLayer(
            d_model,
            nhead,
            dim_feedforward=ff_ratio * d_model,
            dropout=dropout,
            activation=activation,
            batch_first=True,
            norm_first=norm_first,
        )

        self.decoder = nn.TransformerDecoder(decoder_layer, nlayer)

    def forward(
        self, x: Tensor, memory: Tensor, tgt_mask: Tensor, tgt_padding_mask: Tensor
    ) -> Tensor:
        x = self.decoder(
            x, memory, tgt_mask=tgt_mask, tgt_key_padding_mask=tgt_padding_mask
        )
        return x


class EncoderDecoder(nn.Module):
    """Encoder decoder architecture that takes in a tabular image and generates the text output.
    Backbone serves as the image processor. There are three types of backbones: CNN, linear projection, and ConvStem.

    Args:
    ----
        backbone: tabular image processor
        encoder: transformer encoder
        decoder: transformer decoder
        vocab_size: size of the vocabulary
        d_model: feature size
        padding_idx: index of <pad> in the vocabulary
        max_seq_len: max sequence length of generated text
        dropout: dropout rate
        norm_layer: layernorm
        init_std: std in weights initialization
    """

    def __init__(
        self,
        backbone: nn.Module,
        encoder: nn.Module,
        decoder: nn.Module,
        vocab_size: int,
        d_model: int,
        padding_idx: int,
        max_seq_len: int,
        dropout: float,
        norm_layer: nn.Module,
        init_std: float = 0.02,
    ):
        super().__init__()

        self.backbone = backbone
        self.encoder = encoder
        self.decoder = decoder
        self.norm = norm_layer(d_model)
        self.token_embed = TokenEmbedding(
            vocab_size=vocab_size, d_model=d_model, padding_idx=padding_idx
        )
        self.pos_embed = PositionEmbedding(
            max_seq_len=max_seq_len, d_model=d_model, dropout=dropout
        )
        self.generator = nn.Linear(d_model, vocab_size)

        self.trunc_normal = partial(
            nn.init.trunc_normal_, std=init_std, a=-init_std, b=init_std
        )
        self.apply(self._init_weights)

    def _init_weights(self, m: nn.Module):
        if isinstance(m, nn.Linear):
            self.trunc_normal(m.weight)
            if m.bias is not None:
                nn.init.constant_(m.bias, 0.0)
        elif isinstance(m, nn.LayerNorm):
            nn.init.constant_(m.weight, 1.0)
            nn.init.constant_(m.bias, 0.0)
        elif isinstance(m, nn.Conv2d):
            self.trunc_normal(m.weight)
            if m.bias is not None:
                nn.init.constant_(m.bias, 0.0)
        elif isinstance(m, PositionEmbedding):
            self.trunc_normal(m.embedding.weight)
        elif isinstance(m, TokenEmbedding):
            self.trunc_normal(m.embedding.weight)

    @torch.jit.ignore
    def no_weight_decay(self):
        return {"token_embed", "pos_embed"}

    def encode(self, src: Tensor) -> Tensor:
        src_feature = self.backbone(src)
        src_feature = self.pos_embed(src_feature)
        memory = self.encoder(src_feature)
        memory = self.norm(memory)
        return memory

    def decode(
        self, memory: Tensor, tgt: Tensor, tgt_mask: Tensor, tgt_padding_mask: Tensor
    ) -> Tensor:
        tgt_feature = self.pos_embed(self.token_embed(tgt))
        tgt = self.decoder(tgt_feature, memory, tgt_mask, tgt_padding_mask)

        return tgt

    def forward(
        self, src: Tensor, tgt: Tensor, tgt_mask: Tensor, tgt_padding_mask: Tensor
    ) -> Tensor:
        memory = self.encode(src)
        tgt = self.decode(memory, tgt, tgt_mask, tgt_padding_mask)
        tgt = self.generator(tgt)

        return tgt
