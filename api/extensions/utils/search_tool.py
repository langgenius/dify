import difflib
from collections import defaultdict, Counter
import itertools
import re
import jieba
import jieba.analyse
import json
from typing import Any, Optional, cast
import math

class Keywords:
    def __init__(self, texts, main_texts, search_texts, search_sql):
        self.texts = texts
        self.main_texts = main_texts
        self.search_texts=search_texts
        self.search_sql=search_sql

    def to_dict(self):
        return {
            "texts": self.texts,
            "main_texts": self.main_texts,
            "search_texts": self.search_texts,
            "search_sql": self.search_sql,
        }
class TextIndex:
    def __init__(self, text_text, index):
        self.text_text = text_text
        self.index = index

    def to_dict(self):
        return {
            "text_text": self.text_text,
            "index": self.index,
        }

def find_all_occurrences(source: str, target: str):
    return [match.start() for match in re.finditer(re.escape(source), target)]

def get_text_max_score(search_texts: list[str],search_index: int, pos_map,root_list:list[TextIndex], groups:list[list[TextIndex]]):

    if len(search_texts) == search_index and len(root_list) > 0:
        groups.append(root_list)
        return
    search_text = search_texts[search_index]
    text_indexs = pos_map[search_text]
    next_index = search_index + 1
    if text_indexs:
        new_root_list = root_list[:]
        for t_idx,text_index in enumerate(text_indexs):
            this_root_list = []
            if t_idx > 0:
                this_root_list=new_root_list[:]
            else:
                this_root_list = root_list
            this_root_list.append(text_index)
            get_text_max_score(search_texts=search_texts,search_index=next_index,pos_map=pos_map,root_list=this_root_list,groups=groups)
    else:
        get_text_max_score(search_texts=search_texts,search_index=next_index,pos_map=pos_map,root_list=root_list,groups=groups)

# def get_text_index_score(text_indexs: list[TextIndex],search_texts: list[str]):
#     # 去掉一个最后面的
#     # 去掉一个最前面的

def get_text_index_score(text_indexs: list[TextIndex],search_texts: list[str]):

    deduct_points = 0
    text_count = 0
    for idx,text_index in enumerate(text_indexs):
        text_count += len(text_index.text_text)
        if idx < len(text_indexs) - 1:
            next_text_index = text_indexs[idx + 1]
            t_score = 0
            if next_text_index.index > text_index.index:
                t_score = next_text_index.index - text_index.index - len(text_index.text_text) - 1
            else:
                t_score = text_index.index - next_text_index.index - len(next_text_index.text_text)
            t_score = abs(t_score)
            deduct_points += t_score
            if deduct_points > 50:
                return 0
    search_text_count = len("".join(search_texts))
    deduct_points += (search_text_count - text_count) * 3
    return 100 - deduct_points

def get_full_search_text_max_score(search_texts: list[str], target_text: str) -> (int, list[TextIndex]):
    # 1. 建立 source 中每个字符的索引映射
    # pos_map = defaultdict(list)
    text_index_groups:list[list[TextIndex]] = []
    for search_text in search_texts:
        idxs = find_all_occurrences(source=search_text, target=target_text)
        text_indexs = [TextIndex(text_text=search_text,index=idx) for idx in idxs]
        # pos_map[search_text].extend(text_indexs)
        text_index_groups.append(text_indexs)

    # groups:list[list[TextIndex]] = []
    max_score = -100000
    max_index_list:list[TextIndex]=[]
    for text_index_s in itertools.product(*text_index_groups):
        text_index_list:list[TextIndex] = list(text_index_s)
        score_ = get_text_index_score(text_indexs=text_index_list,search_texts=search_texts)
        if score_ < 80:
            continue
        if score_ > max_score:
            max_score = score_
            max_index_list = text_index_list

    # get_text_max_score(search_texts=search_texts,search_index=0,pos_map=pos_map,root_list=[], groups=groups)
    # max_index_list:list[TextIndex] = []
    # max_score = -100000
    # import pdb; pdb.set_trace()
    # for g_list in groups:
    #     score_,milist = get_text_index_score(text_indexs=g_list,search_texts=search_texts)
    #     if score_ > max_score:
    #         max_score = score_
    #         max_index_list = g_list
    #     print("score_",score_)
    #     texts = []
    #     for text_index in g_list:
    #         t_len = len(text_index.text_text)
    #         t_idx = text_index.index
    #         text = target_text[t_idx : t_idx+t_len]
    #         texts.append(text)
    #     print("--------------------------")
    #     print("".join(texts))
    return (max_score,max_index_list)

def get_main_keywords_texts(query_text: str) -> list[str]:
    # 判断关键词的长度
    jieba.analyse.set_stop_words("extensions/utils/stopwords.txt")
    # jieba.analyse.set_idf_path("extensions/utils/idfwords.txt")
    # 提取关键词，默认 topK=30，withWeight=True
    main_keywords_texts__ = jieba.analyse.extract_tags(query_text, topK=200, withWeight=False)

    return main_keywords_texts__

def get_keywords(query_text: str) -> Keywords:
    # 分词器分词关键词
    keyword_texts = list(jieba.cut(query_text))
    keyword_texts_for_search = list(jieba.cut_for_search(query_text))
    print("keyword_texts:",keyword_texts)
    print("keyword_texts_for_search:",keyword_texts_for_search)
    main_keywords_texts__ = get_main_keywords_texts(query_text=query_text)
    print("main_keywords_texts__:",main_keywords_texts__)
    keyword_len = len(main_keywords_texts__)
    main_keywords_len = 0
    # import pdb; pdb.set_trace()
    # 提取80%
    if keyword_len > 4:
        main_keywords_len = int(keyword_len * 0.8)
    else:
        main_keywords_len = keyword_len

    main_keywords_len = keyword_len if main_keywords_len > keyword_len else main_keywords_len
    # 得出最关键的分词
    search_keywords_texts__ = main_keywords_texts__[:main_keywords_len]

    main_keywords_texts = []
    search_keywords_texts = []
    for text in keyword_texts:
        if text in main_keywords_texts__:
            main_keywords_texts.append(text)
        if text in search_keywords_texts__:
            search_keywords_texts.append(text)

    search_sql = get_search_keywords_texts_sql(search_keywords_texts=search_keywords_texts)
    # search_sql = ' & '.join(search_keywords_texts)
    # 按照最关键的分词查询
    keywords = Keywords(
        texts=main_keywords_texts,
        main_texts=main_keywords_texts,
        search_texts=search_keywords_texts,
        search_sql=search_sql
    )
    return keywords

def get_search_keywords_texts_sql(search_keywords_texts:list[str]):

    texts = []
    query_sql_list = []
    for text in search_keywords_texts:
        # 将元素才拆成可查询用的分词
        texts_for_search:list[str] = list(jieba.cut_for_search(text))

        search_texts = [*texts_for_search]
        if text not in search_texts:
            search_texts.append(search_texts)
        query_sql_list.append(f"({" | ".join(search_texts)})")

        min_texts:list[str] = get_min_search_keywords_texts(texts=texts_for_search)
        texts.extend(min_texts)
    query_sql = " & ".join(query_sql_list)
    # import pdb; pdb.set_trace()
    texts_len = len(texts)
    sql = ""
    if texts_len == 1:
        sql = texts[0]
    elif texts_len == 2:
        merge_text = merge_strings(texts[0],texts[1])
        sql = f"{texts[0]} & {texts[1]} | {merge_text}"
    else:
        sql_texts:list[str] = []
        for idx,text in enumerate(texts):
            if idx == 0:
                merge_text = merge_strings(text,texts[idx + 1])
                sql_texts.append(f"({text} | {merge_text})")
            elif idx == texts_len - 2:
                merge_text1 = merge_strings(text,texts[idx + 1])
                merge_text2 = merge_strings(texts[idx-1],text)
                sql_texts.append(f"({text} | {merge_text1} | {merge_text2} & {texts[idx + 1]})")
            elif idx == texts_len - 1:
                merge_text = merge_strings(texts[idx-1],text)
                sql_texts.append(f"({text} | {merge_text})")
            else:
                merge_text1 = merge_strings(text,texts[idx + 1])
                merge_text2 = merge_strings(texts[idx-1],text)
                merge_text3 = merge_strings(texts[idx + 1],texts[idx + 2])
                sql_texts.append(f"({text} | {merge_text1} | {merge_text2} & ({texts[idx + 1]} | {merge_text3}))")
        sql = " & ".join(sql_texts)
    print(sql)

    return f"({sql}) | ({query_sql})"

def merge_strings(text1, text2):
    max_overlap = 0
    min_len = min(len(text1), len(text2))

    # 找出最大重叠部分
    for i in range(1, min_len + 1):
        if text1[-i:] == text2[:i]:
            max_overlap = i
    # 合并字符串
    text = text1 + text2[max_overlap:]
    return text

def get_min_search_keywords_texts(texts:list[str]):
    # import pdb; pdb.set_trace()
    min_texts = []
    for text in texts:
        b = True
        for text2 in texts:
            if text != text2 and text2 in text:
                b = False
        if b:
            min_texts.append(text)
    return min_texts

# 扩展处理分值（全文检索的方法需要处理分值）
def set_full_search_score(query:str,doc_list:list[dict[str, Any]]):
    # 根据查询条件的长短
    main_keywords_texts = get_main_keywords_texts(query_text=query)

    all_texts = []
    for main_keywords_text in main_keywords_texts:
        keyword_texts_for_search = list(jieba.cut_for_search(main_keywords_text))
        all_texts.extend(keyword_texts_for_search)

    sum_lens = len(all_texts)
    sum_lens = 2 if sum_lens == 1 else sum_lens
    plus_score = score(sum_lens)
    print("plus_score",plus_score)
    if doc_list:
        for doc in doc_list:
            metadata = doc["metadata"]
            if metadata:
                dataset_name = metadata["dataset_name"]
                doc_score = metadata["score"]
                if dataset_name == "FULL_TEXT_SEARCH_KNOWLEDGE" and doc_score:
                    doc_score += plus_score
                    doc["metadata"]["score"] = doc_score
                    print("new score:",doc["metadata"]["score"])
        for doc in doc_list:
            if doc["metadata"] and doc["metadata"]["score"]:
                print("new score:",doc["metadata"]["score"])

def score(value):
    return round(20 * math.exp(-0.4 * value), 2) / 100

def get_main_keywords_texts_test(query_text: str) -> list[str]:
    # 判断关键词的长度
    jieba.analyse.set_stop_words("d://stopwords.txt")
    # jieba.analyse.set_idf_path("extensions/utils/idfwords.txt")
    # 提取关键词，默认 topK=30，withWeight=True
    main_keywords_texts__ = jieba.analyse.extract_tags(query_text, topK=200, withWeight=False)

    return main_keywords_texts__

if __name__ == "__main__":
    # print(merge_strings("第二","二层"))
    get_keywords("我的")
    # search_texts=["湖人","阵容"]
    # score, max_index_list =get_full_search_text_max_score(search_texts=search_texts, source="所以，**严格讲，詹姆斯在湖人确实拥有超级巨星（戴维斯），但不像热火三巨头那样多核并立。**更多时候，他还是湖人阵容的绝对核心和领袖。")
    # print(score, len(max_index_list))
