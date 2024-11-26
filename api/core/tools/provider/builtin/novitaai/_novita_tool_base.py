from novita_client import (
    Txt2ImgV3Embedding,
    Txt2ImgV3HiresFix,
    Txt2ImgV3LoRA,
    Txt2ImgV3Refiner,
    V3TaskImage,
)


class NovitaAiToolBase:
    def _extract_loras(self, loras_str: str):
        if not loras_str:
            return []

        loras_ori_list = loras_str.strip().split(";")
        result_list = []
        for lora_str in loras_ori_list:
            lora_info = lora_str.strip().split(",")
            lora = Txt2ImgV3LoRA(
                model_name=lora_info[0].strip(),
                strength=float(lora_info[1]),
            )
            result_list.append(lora)

        return result_list

    def _extract_embeddings(self, embeddings_str: str):
        if not embeddings_str:
            return []

        embeddings_ori_list = embeddings_str.strip().split(";")
        result_list = []
        for embedding_str in embeddings_ori_list:
            embedding = Txt2ImgV3Embedding(model_name=embedding_str.strip())
            result_list.append(embedding)

        return result_list

    def _extract_hires_fix(self, hires_fix_str: str):
        hires_fix_info = hires_fix_str.strip().split(",")
        if "upscaler" in hires_fix_info:
            hires_fix = Txt2ImgV3HiresFix(
                target_width=int(hires_fix_info[0]),
                target_height=int(hires_fix_info[1]),
                strength=float(hires_fix_info[2]),
                upscaler=hires_fix_info[3].strip(),
            )
        else:
            hires_fix = Txt2ImgV3HiresFix(
                target_width=int(hires_fix_info[0]),
                target_height=int(hires_fix_info[1]),
                strength=float(hires_fix_info[2]),
            )

        return hires_fix

    def _extract_refiner(self, switch_at: str):
        refiner = Txt2ImgV3Refiner(switch_at=float(switch_at))
        return refiner

    def _is_hit_nsfw_detection(self, image: V3TaskImage, confidence_threshold: float) -> bool:
        """
        is hit nsfw
        """
        if image.nsfw_detection_result is None:
            return False
        if image.nsfw_detection_result.valid and image.nsfw_detection_result.confidence >= confidence_threshold:
            return True
        return False
