from typing import Literal

TorchDevice = Literal["cuda", "cpu", "mps"]


class Config:
    def __init__(self):
        self._device = "cpu"  # Default to CPU
        self._torch_available = False
        self._cuda_available = False
        try:
            import torch

            self._torch_available = True
            if torch.cuda.is_available():
                self._device = "cuda"
                self._cuda_available = True
        except ImportError:
            pass

    def set_device(self, device: TorchDevice) -> None:
        if not self._torch_available and device == "cuda":
            raise RuntimeError(
                "CUDA device requested but torch is not available. Have you installed ml dependencies?"
            )
        if not self._cuda_available and device == "cuda":
            raise RuntimeError("CUDA device requested but CUDA is not available")
        if device not in ["cuda", "cpu", "mps"]:
            raise ValueError("Device must be 'cuda', 'cpu' or 'mps'")
        self._device = device

    def get_device(self):
        if self._torch_available:
            import torch

            return torch.device(self._device)
        else:
            return self._device


config = Config()
