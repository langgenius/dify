"""Functionality for splitting text."""

from __future__ import annotations

from typing import Any, Optional

from core.model_manager import ModelInstance
from core.model_runtime.model_providers.__base.tokenizers.gpt2_tokenzier import GPT2Tokenizer
from core.rag.splitter.text_splitter import (
    TS,
    Collection,
    Literal,
    RecursiveCharacterTextSplitter,
    Set,
    TokenTextSplitter,
    Union,
)


class EnhanceRecursiveCharacterTextSplitter(RecursiveCharacterTextSplitter):
    """
    This class is used to implement from_gpt2_encoder, to prevent using of tiktoken
    """

    @classmethod
    def from_encoder(
        cls: type[TS],
        embedding_model_instance: Optional[ModelInstance],
        allowed_special: Union[Literal["all"], Set[str]] = set(),  # noqa: UP037
        disallowed_special: Union[Literal["all"], Collection[str]] = "all",  # noqa: UP037
        **kwargs: Any,
    ):
        def _token_encoder(texts: list[str]) -> list[int]:
            if not texts:
                return []

            if embedding_model_instance:
                return embedding_model_instance.get_text_embedding_num_tokens(texts=texts)
            else:
                return [GPT2Tokenizer.get_num_tokens(text) for text in texts]

        def _character_encoder(texts: list[str]) -> list[int]:
            if not texts:
                return []

            return [len(text) for text in texts]

        if issubclass(cls, TokenTextSplitter):
            extra_kwargs = {
                "model_name": embedding_model_instance.model if embedding_model_instance else "gpt2",
                "allowed_special": allowed_special,
                "disallowed_special": disallowed_special,
            }
            kwargs = {**kwargs, **extra_kwargs}

        return cls(length_function=_character_encoder, **kwargs)


class FixedRecursiveCharacterTextSplitter(EnhanceRecursiveCharacterTextSplitter):
    def __init__(self, fixed_separator: str = "\n\n", separators: Optional[list[str]] = None, **kwargs: Any):
        """Create a new TextSplitter."""
        super().__init__(**kwargs)
        self._fixed_separator = fixed_separator
        self._separators = separators or ["\n\n", "\n", " ", ""]

    def split_text(self, text: str) -> list[str]:
        """Split incoming text and return chunks."""
        if self._fixed_separator:
            chunks = text.split(self._fixed_separator)
        else:
            chunks = [text]

        final_chunks = []
        chunks_lengths = self._length_function(chunks)
        for chunk, chunk_length in zip(chunks, chunks_lengths):
            if chunk_length > self._chunk_size:
                if self._keep_separator :
                    final_chunks.extend(self.recursive_split_text_keep_separator_(chunk))  # 调用递归分割方法进一步拆分。
                    continue
                final_chunks.extend(self.recursive_split_text(chunk))
            else:
                final_chunks.append(chunk)

        return final_chunks

    def recursive_split_text(self, text: str) -> list[str]:
        """Split incoming text and return chunks."""

        final_chunks = []
        separator = self._separators[-1]
        new_separators = []

        for i, _s in enumerate(self._separators):
            if _s == "":
                separator = _s
                break
            if _s in text:
                separator = _s
                new_separators = self._separators[i + 1 :]
                break

        # Now that we have the separator, split the text
        if separator:
            if separator == " ":
                splits = text.split()
            else:
                splits = text.split(separator)
        else:
            splits = list(text)
        splits = [s for s in splits if (s not in {"", "\n"})]
        _good_splits = []
        _good_splits_lengths = []  # cache the lengths of the splits
        _separator = "" if self._keep_separator else separator
        s_lens = self._length_function(splits)
        if separator != "":
            for s, s_len in zip(splits, s_lens):
                if s_len < self._chunk_size:
                    _good_splits.append(s)
                    _good_splits_lengths.append(s_len)
                else:
                    if _good_splits:
                        merged_text = self._merge_splits(_good_splits, _separator, _good_splits_lengths)
                        final_chunks.extend(merged_text)
                        _good_splits = []
                        _good_splits_lengths = []
                    if not new_separators:
                        final_chunks.append(s)
                    else:
                        other_info = self._split_text(s, new_separators)
                        final_chunks.extend(other_info)

            if _good_splits:
                merged_text = self._merge_splits(_good_splits, _separator, _good_splits_lengths)
                final_chunks.extend(merged_text)
        else:
            current_part = ""
            current_length = 0
            overlap_part = ""
            overlap_part_length = 0
            for s, s_len in zip(splits, s_lens):
                if current_length + s_len <= self._chunk_size - self._chunk_overlap:
                    current_part += s
                    current_length += s_len
                elif current_length + s_len <= self._chunk_size:
                    current_part += s
                    current_length += s_len
                    overlap_part += s
                    overlap_part_length += s_len
                else:
                    final_chunks.append(current_part)
                    current_part = overlap_part + s
                    current_length = s_len + overlap_part_length
                    overlap_part = ""
                    overlap_part_length = 0
            if current_part:
                final_chunks.append(current_part)

        return final_chunks



    def recursive_split_text_keep_separator_(self, text: str) -> list[str]:  # 定义递归分割方法。
        """Split incoming text and return chunks."""  # 文档字符串，说明该方法的作用是递归地分割文本并返回块。

        final_chunks = []  # 初始化最终的块列表。
        current_part_list = []
        self.append_next_split_text(current_part_list=current_part_list,
                                    current_length_list=[],
                                    text=text,
                                    final_chunks = final_chunks,
                                    separators = self._separators)

        if len(current_part_list):  # 如果还有剩余的当前块。
            final_chunks.append("".join(current_part_list))  # 将其加入最终块列表。

        return final_chunks  # 返回最终的块列表。

    @classmethod
    def get_splits_(self,text:str, separators:list[str]) -> (list[str],list[str]):  # 定义递归分割方法。
        """Split incoming text and return chunks."""  # 文档字符串，说明该方法的作用是递归地分割文本并返回块。
        if len(separators) > 0:
            separator = separators[-1]  # 默认使用备用分隔符列表中的最后一个分隔符。
            new_separators = []  # 初始化新的分隔符列表。
            for i, _s in enumerate(separators):  # 遍历备用分隔符列表。
                if _s in text:  # 如果当前分隔符存在于文本中。
                    separator = _s  # 设置分隔符为当前分隔符。
                    new_separators = separators[i + 1 :]  # 更新新的分隔符列表。
                    break  # 结束循环。
            # Now that we have the separator, split the text  # 已经确定了分隔符，开始分割文本。
            if separator:  # 如果分隔符不为空。
                splits = text.split(separator)  # 按指定分隔符分割文本。
            else:  # 如果分隔符为空字符串。
                splits = list(text)  # 将文本按字符分割成列表。
            # splits = [s for s in splits if (s not in {""})]  # 过滤掉空字符串和换行符。
            return splits,new_separators
        else:
            return [text],[]

    def append_next_split_text(self,
                               current_part_list:list[str],
                               current_length_list:list[int],
                               text: str,
                               final_chunks: list[str],
                               separators : list[str]):  # 定义递归分割方法。
        if text:
            # 需要判断是否可以再拼接
            splits, new_separators_ = self.get_splits_(text, separators)
            s_lens = self._length_function(splits)  # 计算每个分割部分的长度。
            for s, s_len in zip(splits, s_lens):  # 遍历每个分割部分及其长度。

                current_length = sum(current_length_list)
                if "制定综合主进度" in s:
                    # import pdb; pdb.post_mortem()
                    print(s)

                if current_length + s_len <= self._chunk_size:  # 如果当前块可以容纳更多内容。
                    current_part_list.append(s)  # 将当前部分加入当前块。
                    current_length_list.append(s_len)
                else:
                    if len(new_separators_) == 0:
                        # 将片段加入到列表中
                        final_chunks.append("".join(current_part_list))
                        # 计算出重叠部分的内容
                        overlap_part_length_,overlap_part_ = self.get_overlap_part(current_part_list,current_length_list)
                        # 将重叠部分作为下一个片段的开头
                        current_part_list.clear()
                        current_part_list.append(overlap_part_)
                        current_length_list.clear()
                        current_length_list.append(overlap_part_length_)

                        if overlap_part_length_ + s_len <= self._chunk_size:  # 如果当前块可以容纳更多内容。
                            current_part_list.append(s)  # 将当前部分加入当前块。
                            current_length_list.append(s_len)
                            continue
                    # 递归计算
                    self.append_next_split_text(current_part_list=current_part_list,
                                                current_length_list=current_length_list,
                                                text=s,
                                                final_chunks=final_chunks,
                                                separators=new_separators_)

    def get_overlap_part(self,current_part_list:list[str],
                               current_length_list:list[int]) -> (int,str):  # 定义递归分割方法。
        # 一下计算出
        overlap_part_length_ = 0
        overlap_part_list = []
        current_length_list_reversed = list(reversed(current_length_list))
        current_part_list_reversed = list(reversed(current_part_list))
        for index, s_len_ in enumerate(current_length_list_reversed):
            if overlap_part_length_ + s_len_ > self._chunk_overlap:
                if overlap_part_length_ < self._chunk_overlap:
                    text = current_part_list_reversed[index]
                    texts = list(text)
                    text_lens = self._length_function(texts)
                    texts_reversed = list(reversed(texts))
                    text_lens_reversed = list(reversed(text_lens))
                    for s_, len_ in zip(texts_reversed,text_lens_reversed):
                        if overlap_part_length_ + len_ > self._chunk_overlap:
                            break
                        overlap_part_length_ += len_
                        overlap_part_list[0:0] = s_
                        # overlap_part_list.append(s_)
                break
            overlap_part_length_ += s_len_
            overlap_part_list[0:0] = current_part_list_reversed[index]
            # overlap_part_list.append(current_part_list_reversed[index])
        return overlap_part_length_, "".join(overlap_part_list)
