import difflib
from collections import defaultdict, Counter
import itertools
import re

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
    search_text_count = len("".join(search_texts))
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
    deduct_points += (search_text_count - text_count) * 3
    return 100 - deduct_points

def get_full_search_text_max_score(search_texts: list[str], target_text: str) -> (int, list[TextIndex]):
    import pdb; pdb.set_trace()
    # 1. 建立 source 中每个字符的索引映射
    # pos_map = defaultdict(list)
    text_index_groups:list[list[TextIndex]] = []
    for search_text in search_texts:
        idxs = find_all_occurrences(source=search_text, target=target_text)
        text_indexs = [TextIndex(text_text=search_text,index=idx) for idx in idxs]
        # pos_map[search_text].extend(text_indexs)
        text_index_groups.append(text_indexs)

    import pdb; pdb.set_trace()
    # groups:list[list[TextIndex]] = []
    max_score = -100000
    max_index_list:list[TextIndex]
    for text_index_s in itertools.product(*text_index_groups):
        text_index_list:list[TextIndex] = list(text_index_s)
        score_ = get_text_index_score(text_indexs=text_index_list,search_texts=search_texts)
        if score_ < 50:
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
    import pdb; pdb.set_trace()
    return (max_score,max_index_list)

if __name__ == "__main__":
    search_texts=["湖人","阵容"]
    score, max_index_list =get_full_search_text_max_score(search_texts=search_texts, source="所以，**严格讲，詹姆斯在湖人确实拥有超级巨星（戴维斯），但不像热火三巨头那样多核并立。**更多时候，他还是湖人阵容的绝对核心和领袖。")
    print(score, len(max_index_list))
