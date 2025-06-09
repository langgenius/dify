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
    """  # 文档字符串，说明该类的作用是实现基于 GPT-2 的编码器，避免使用 tiktoken。

    @classmethod
    def from_encoder(
        cls: type[TS],
        allowed_special: Union[Literal["all"], Set[str]] = set(),  # 允许的特殊字符集合，默认为空集。
        disallowed_special: Union[Literal["all"], Collection[str]] = "all",  # 禁止的特殊字符集合，默认为 "all"。
        **kwargs: Any,  # 其他关键字参数。
    ):
        def _token_encoder(texts: list[str]) -> list[int]:  # 定义一个内部函数，用于计算文本的 token 数量。
            if not texts:  # 如果输入的文本列表为空，则返回空列表。
                return []
            # 否则，使用默认的 GPT-2 tokenizer 计算 token 数量。
            return [GPT2Tokenizer.get_num_tokens(text) for text in texts]

        if issubclass(cls, TokenTextSplitter):  # 如果当前类是 TokenTextSplitter 的子类。
            extra_kwargs = {  # 构造额外的关键字参数。
                "model_name": "gpt2",  # 模型名称。
                "allowed_special": allowed_special,  # 允许的特殊字符。
                "disallowed_special": disallowed_special,  # 禁止的特殊字符。
            }
            kwargs = {**kwargs, **extra_kwargs}  # 将额外参数合并到 kwargs 中。

        return cls(length_function=_token_encoder, **kwargs)  # 返回当前类的实例，并传入长度计算函数和其他参数。


class FixedRecursiveCharacterTextSplitter(EnhanceRecursiveCharacterTextSplitter):
    def __init__(self, fixed_separator: str = "\n\n", separators: Optional[list[str]] = None, **kwargs: Any):
        """Create a new TextSplitter."""  # 文档字符串，说明构造函数的作用是创建一个新的文本分割器。
        super().__init__(**kwargs)  # 调用父类的构造函数，初始化基类的属性。
        self._fixed_separator = fixed_separator  # 固定分隔符，默认为 "\n\n"。
        self._separators = separators or ["\n\n", "\n", " ", ""]  # 备用分隔符列表，默认为 ["\n\n", "\n", " ", ""]。

    def split_text(self, text: str) -> list[str]:  # 定义主方法，用于分割文本。
        """Split incoming text and return chunks."""  # 文档字符串，说明该方法的作用是分割输入文本并返回块。
        if self._fixed_separator:  # 如果设置了固定分隔符。
            chunks = text.split(self._fixed_separator)  # 使用固定分隔符将文本分割成初步的块。
        else:  # 如果未设置固定分隔符。
            chunks = [text]  # 将整个文本作为一个块。

        final_chunks = []  # 初始化最终的块列表。
        chunks_lengths = self._length_function(chunks)  # 计算每个块的长度。
        for chunk, chunk_length in zip(chunks, chunks_lengths):  # 遍历每个块及其长度。
            if chunk_length > self._chunk_size:  # 如果块的长度超过限制。
                if self._keep_separator :
                    final_chunks.extend(self.recursive_split_text_keep_separator_(chunk))  # 调用递归分割方法进一步拆分。
                    continue
                final_chunks.extend(self.recursive_split_text_(chunk))  # 调用递归分割方法进一步拆分。
            else:  # 如果块的长度未超过限制。
                final_chunks.append(chunk)  # 直接保留该块。

        return final_chunks  # 返回最终的块列表。

    def recursive_split_text_(self, text: str) -> list[str]:  # 定义递归分割方法。
        """Split incoming text and return chunks."""  # 文档字符串，说明该方法的作用是递归地分割文本并返回块。

        final_chunks = []  # 初始化最终的块列表。
        separator = self._separators[-1]  # 默认使用备用分隔符列表中的最后一个分隔符。
        new_separators = []  # 初始化新的分隔符列表。

        for i, _s in enumerate(self._separators):  # 遍历备用分隔符列表。
            if _s == "":  # 如果遇到空字符串分隔符。
                separator = _s  # 设置分隔符为空字符串。
                break  # 结束循环。
            if _s in text:  # 如果当前分隔符存在于文本中。
                separator = _s  # 设置分隔符为当前分隔符。
                new_separators = self._separators[i + 1 :]  # 更新新的分隔符列表。
                break  # 结束循环。

        # Now that we have the separator, split the text  # 已经确定了分隔符，开始分割文本。
        if separator:  # 如果分隔符不为空。
            if separator == " ":  # 如果分隔符是空格。
                splits = text.split()  # 按空格分割文本。
            else:  # 如果分隔符不是空格。
                splits = text.split(separator)  # 按指定分隔符分割文本。
        else:  # 如果分隔符为空字符串。
            splits = list(text)  # 将文本按字符分割成列表。
        splits = [s for s in splits if (s not in {""})]  # 过滤掉空字符串和换行符。

        _good_splits = []  # 初始化符合长度要求的块列表。
        _good_splits_lengths = []  # 缓存这些块的长度。
        self._keep_separator = False
        _separator = "" if self._keep_separator else separator  # 根据是否保留分隔符决定连接符。
        s_lens = self._length_function(splits)  # 计算每个分割部分的长度。
        if _separator != "":  # 如果连接符不为空。
            for s, s_len in zip(splits, s_lens):  # 遍历每个分割部分及其长度。
                print("-----",s,s_len,self._chunk_size)
                if s_len < self._chunk_size:  # 如果长度小于限制。
                    _good_splits.append(s)  # 将其加入符合要求的块列表。
                    _good_splits_lengths.append(s_len)  # 缓存其长度。
                else:  # 如果长度超出限制。
                    if _good_splits:  # 如果有符合要求的块。
                        merged_text = self._merge_splits(_good_splits, _separator, _good_splits_lengths)  # 合并这些块。
                        final_chunks.extend(merged_text)  # 将合并后的块加入最终块列表。
                        _good_splits = []  # 清空符合要求的块列表。
                        _good_splits_lengths = []  # 清空长度缓存。
                    if not new_separators:  # 如果没有新的分隔符。
                        final_chunks.append(s)  # 直接保留当前部分。
                    else:  # 如果有新的分隔符。
                        other_info = self._split_text(s, new_separators)  # 递归调用分割方法。
                        final_chunks.extend(other_info)  # 将结果加入最终块列表。

            if _good_splits:  # 如果还有剩余的符合要求的块。
                merged_text = self._merge_splits(_good_splits, _separator, _good_splits_lengths)  # 合并这些块。
                final_chunks.extend(merged_text)  # 将合并后的块加入最终块列表。
        else:  # 如果连接符为空。
            current_part = ""  # 初始化当前块。
            current_length = 0  # 初始化当前块的长度。
            overlap_part = ""  # 初始化重叠部分。
            overlap_part_length = 0  # 初始化重叠部分的长度。
            for s, s_len in zip(splits, s_lens):  # 遍历每个分割部分及其长度。
                if current_length + s_len <= self._chunk_size - self._chunk_overlap:  # 如果当前块可以容纳更多内容。
                    current_part += s  # 将当前部分加入当前块。
                    current_length += s_len  # 更新当前块的长度。
                elif current_length + s_len <= self._chunk_size:  # 如果当前块接近长度限制。
                    current_part += s  # 将当前部分加入当前块。
                    current_length += s_len  # 更新当前块的长度。
                    overlap_part += s  # 将当前部分加入重叠部分。
                    overlap_part_length += s_len  # 更新重叠部分的长度。
                else:  # 如果当前块已满。
                    final_chunks.append(current_part)  # 将当前块加入最终块列表。
                    current_part = overlap_part + s  # 构造新的当前块。
                    current_length = s_len + overlap_part_length  # 更新当前块的长度。
                    overlap_part = ""  # 清空重叠部分。
                    overlap_part_length = 0  # 清空重叠部分的长度。
            if current_part:  # 如果还有剩余的当前块。
                final_chunks.append(current_part)  # 将其加入最终块列表。

        return final_chunks  # 返回最终的块列表。

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

    def get_overlap_part(self,
                               current_part_list:list[str],
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