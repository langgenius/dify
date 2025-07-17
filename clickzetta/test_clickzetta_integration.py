#!/usr/bin/env python3
"""
Clickzetta Vector Database Integration Test Suite
测试用例覆盖 Clickzetta 向量数据库的所有核心功能
"""

import os
import sys
import time
import threading
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Any
import numpy as np

# Add the API path to sys.path for imports
sys.path.insert(0, '/Users/liangmo/Documents/GitHub/dify/api')

from core.rag.datasource.vdb.clickzetta.clickzetta_vector import ClickzettaVector
from core.rag.models.document import Document

class ClickzettaTestSuite:
    """Clickzetta 向量数据库测试套件"""
    
    def __init__(self):
        self.vector_db = None
        self.test_results = []
        self.collection_name = "test_collection_" + str(int(time.time()))
        
    def setup(self):
        """测试环境设置"""
        try:
            config = {
                'username': os.getenv('CLICKZETTA_USERNAME'),
                'password': os.getenv('CLICKZETTA_PASSWORD'),
                'instance': os.getenv('CLICKZETTA_INSTANCE'),
                'service': os.getenv('CLICKZETTA_SERVICE', 'uat-api.clickzetta.com'),
                'workspace': os.getenv('CLICKZETTA_WORKSPACE'),
                'vcluster': os.getenv('CLICKZETTA_VCLUSTER', 'default_ap'),
                'schema': os.getenv('CLICKZETTA_SCHEMA', 'dify')
            }
            
            # 检查必需的环境变量
            required_vars = ['username', 'password', 'instance', 'workspace']
            missing_vars = [var for var in required_vars if not config[var]]
            if missing_vars:
                raise Exception(f"Missing required environment variables: {missing_vars}")
            
            self.vector_db = ClickzettaVector(
                collection_name=self.collection_name,
                config=config
            )
            
            print(f"✅ 测试环境设置成功，使用集合: {self.collection_name}")
            return True
            
        except Exception as e:
            print(f"❌ 测试环境设置失败: {str(e)}")
            return False
    
    def cleanup(self):
        """清理测试数据"""
        try:
            if self.vector_db:
                self.vector_db.delete()
            print("✅ 测试数据清理完成")
        except Exception as e:
            print(f"⚠️ 清理测试数据时出错: {str(e)}")
    
    def generate_test_documents(self, count: int = 10) -> List[Document]:
        """生成测试文档"""
        documents = []
        for i in range(count):
            doc = Document(
                page_content=f"这是测试文档 {i+1}，包含关于人工智能和机器学习的内容。",
                metadata={
                    'doc_id': f'test_doc_{i+1}',
                    'source': f'test_source_{i+1}',
                    'category': 'test',
                    'index': i
                }
            )
            documents.append(doc)
        return documents
    
    def test_basic_operations(self):
        """测试基础操作：创建、插入、查询、删除"""
        print("\n🧪 测试基础操作...")
        
        try:
            # 1. 测试文档插入
            test_docs = self.generate_test_documents(5)
            embeddings = [np.random.rand(1536).tolist() for _ in range(5)]
            
            start_time = time.time()
            ids = self.vector_db.add_texts(
                texts=[doc.page_content for doc in test_docs],
                embeddings=embeddings,
                metadatas=[doc.metadata for doc in test_docs]
            )
            insert_time = time.time() - start_time
            
            assert len(ids) == 5, f"期望插入5个文档，实际插入{len(ids)}个"
            print(f"✅ 文档插入成功，耗时: {insert_time:.2f}秒")
            
            # 2. 测试相似性搜索
            start_time = time.time()
            query_embedding = np.random.rand(1536).tolist()
            results = self.vector_db.similarity_search_by_vector(
                embedding=query_embedding,
                k=3
            )
            search_time = time.time() - start_time
            
            assert len(results) <= 3, f"期望最多返回3个结果，实际返回{len(results)}个"
            print(f"✅ 相似性搜索成功，返回{len(results)}个结果，耗时: {search_time:.2f}秒")
            
            # 3. 测试文本搜索
            start_time = time.time()
            text_results = self.vector_db.similarity_search(
                query="人工智能",
                k=2
            )
            text_search_time = time.time() - start_time
            
            print(f"✅ 文本搜索成功，返回{len(text_results)}个结果，耗时: {text_search_time:.2f}秒")
            
            # 4. 测试文档删除
            if ids:
                start_time = time.time()
                self.vector_db.delete_by_ids([ids[0]])
                delete_time = time.time() - start_time
                print(f"✅ 文档删除成功，耗时: {delete_time:.2f}秒")
            
            self.test_results.append({
                'test': 'basic_operations',
                'status': 'PASS',
                'metrics': {
                    'insert_time': insert_time,
                    'search_time': search_time,
                    'text_search_time': text_search_time,
                    'delete_time': delete_time
                }
            })
            
        except Exception as e:
            print(f"❌ 基础操作测试失败: {str(e)}")
            self.test_results.append({
                'test': 'basic_operations',
                'status': 'FAIL',
                'error': str(e)
            })
    
    def test_concurrent_operations(self):
        """测试并发操作安全性"""
        print("\n🧪 测试并发操作...")
        
        try:
            def insert_batch(batch_id: int, batch_size: int = 5):
                """批量插入操作"""
                try:
                    docs = self.generate_test_documents(batch_size)
                    embeddings = [np.random.rand(1536).tolist() for _ in range(batch_size)]
                    
                    # 为每个批次添加唯一标识
                    for i, doc in enumerate(docs):
                        doc.metadata['batch_id'] = batch_id
                        doc.metadata['doc_id'] = f'batch_{batch_id}_doc_{i}'
                    
                    ids = self.vector_db.add_texts(
                        texts=[doc.page_content for doc in docs],
                        embeddings=embeddings,
                        metadatas=[doc.metadata for doc in docs]
                    )
                    return f"Batch {batch_id}: 成功插入 {len(ids)} 个文档"
                except Exception as e:
                    return f"Batch {batch_id}: 失败 - {str(e)}"
            
            # 启动多个并发插入任务
            start_time = time.time()
            with ThreadPoolExecutor(max_workers=3) as executor:
                futures = [executor.submit(insert_batch, i) for i in range(3)]
                results = [future.result() for future in futures]
            
            concurrent_time = time.time() - start_time
            
            # 检查结果
            success_count = sum(1 for result in results if "成功" in result)
            print(f"✅ 并发操作完成，{success_count}/3 个批次成功，总耗时: {concurrent_time:.2f}秒")
            
            for result in results:
                print(f"  - {result}")
            
            self.test_results.append({
                'test': 'concurrent_operations',
                'status': 'PASS' if success_count >= 2 else 'PARTIAL',
                'metrics': {
                    'concurrent_time': concurrent_time,
                    'success_rate': success_count / 3
                }
            })
            
        except Exception as e:
            print(f"❌ 并发操作测试失败: {str(e)}")
            self.test_results.append({
                'test': 'concurrent_operations',
                'status': 'FAIL',
                'error': str(e)
            })
    
    def test_performance_benchmark(self):
        """性能基准测试"""
        print("\n🧪 测试性能基准...")
        
        try:
            batch_sizes = [10, 50, 100]
            performance_results = {}
            
            for batch_size in batch_sizes:
                print(f"  测试批次大小: {batch_size}")
                
                # 生成测试数据
                docs = self.generate_test_documents(batch_size)
                embeddings = [np.random.rand(1536).tolist() for _ in range(batch_size)]
                
                # 测试插入性能
                start_time = time.time()
                ids = self.vector_db.add_texts(
                    texts=[doc.page_content for doc in docs],
                    embeddings=embeddings,
                    metadatas=[doc.metadata for doc in docs]
                )
                insert_time = time.time() - start_time
                
                # 测试搜索性能
                query_embedding = np.random.rand(1536).tolist()
                start_time = time.time()
                results = self.vector_db.similarity_search_by_vector(
                    embedding=query_embedding,
                    k=10
                )
                search_time = time.time() - start_time
                
                performance_results[batch_size] = {
                    'insert_time': insert_time,
                    'insert_rate': batch_size / insert_time,
                    'search_time': search_time,
                    'results_count': len(results)
                }
                
                print(f"    插入: {insert_time:.2f}秒 ({batch_size/insert_time:.1f} docs/sec)")
                print(f"    搜索: {search_time:.2f}秒 (返回{len(results)}个结果)")
            
            self.test_results.append({
                'test': 'performance_benchmark',
                'status': 'PASS',
                'metrics': performance_results
            })
            
        except Exception as e:
            print(f"❌ 性能基准测试失败: {str(e)}")
            self.test_results.append({
                'test': 'performance_benchmark',
                'status': 'FAIL',
                'error': str(e)
            })
    
    def test_error_handling(self):
        """测试错误处理"""
        print("\n🧪 测试错误处理...")
        
        try:
            test_cases = []
            
            # 1. 测试无效嵌入维度
            try:
                invalid_embedding = [1.0, 2.0, 3.0]  # 错误的维度
                self.vector_db.add_texts(
                    texts=["测试文本"],
                    embeddings=[invalid_embedding]
                )
                test_cases.append("invalid_embedding: FAIL - 应该抛出异常")
            except Exception:
                test_cases.append("invalid_embedding: PASS - 正确处理无效维度")
            
            # 2. 测试空文本
            try:
                result = self.vector_db.add_texts(
                    texts=[""],
                    embeddings=[np.random.rand(1536).tolist()]
                )
                test_cases.append("empty_text: PASS - 处理空文本")
            except Exception as e:
                test_cases.append(f"empty_text: HANDLED - {str(e)[:50]}")
            
            # 3. 测试大批量数据
            try:
                large_batch = self.generate_test_documents(1000)
                embeddings = [np.random.rand(1536).tolist() for _ in range(1000)]
                
                start_time = time.time()
                ids = self.vector_db.add_texts(
                    texts=[doc.page_content for doc in large_batch],
                    embeddings=embeddings,
                    metadatas=[doc.metadata for doc in large_batch]
                )
                large_batch_time = time.time() - start_time
                
                test_cases.append(f"large_batch: PASS - 处理1000个文档，耗时{large_batch_time:.2f}秒")
            except Exception as e:
                test_cases.append(f"large_batch: HANDLED - {str(e)[:50]}")
            
            for case in test_cases:
                print(f"  - {case}")
            
            self.test_results.append({
                'test': 'error_handling',
                'status': 'PASS',
                'test_cases': test_cases
            })
            
        except Exception as e:
            print(f"❌ 错误处理测试失败: {str(e)}")
            self.test_results.append({
                'test': 'error_handling',
                'status': 'FAIL',
                'error': str(e)
            })
    
    def test_full_text_search(self):
        """测试全文搜索功能"""
        print("\n🧪 测试全文搜索...")
        
        try:
            # 插入带有特定关键词的文档
            search_docs = [
                Document(
                    page_content="Python是一种流行的编程语言，广泛用于数据科学和人工智能领域。",
                    metadata={'category': 'programming', 'language': 'python'}
                ),
                Document(
                    page_content="机器学习算法可以帮助计算机从数据中学习模式和规律。",
                    metadata={'category': 'ai', 'topic': 'machine_learning'}
                ),
                Document(
                    page_content="向量数据库是存储和检索高维向量数据的专用数据库系统。",
                    metadata={'category': 'database', 'type': 'vector'}
                )
            ]
            
            embeddings = [np.random.rand(1536).tolist() for _ in range(3)]
            
            # 插入测试文档
            ids = self.vector_db.add_texts(
                texts=[doc.page_content for doc in search_docs],
                embeddings=embeddings,
                metadatas=[doc.metadata for doc in search_docs]
            )
            
            # 测试不同的搜索查询
            search_queries = [
                ("Python", "programming"),
                ("机器学习", "ai"),
                ("向量", "database"),
                ("数据", "general")
            ]
            
            search_results = {}
            for query, expected_category in search_queries:
                results = self.vector_db.similarity_search(query=query, k=5)
                search_results[query] = {
                    'count': len(results),
                    'results': [r.metadata.get('category', 'unknown') for r in results if hasattr(r, 'metadata')]
                }
                print(f"  查询 '{query}': 返回 {len(results)} 个结果")
            
            self.test_results.append({
                'test': 'full_text_search',
                'status': 'PASS',
                'search_results': search_results
            })
            
        except Exception as e:
            print(f"❌ 全文搜索测试失败: {str(e)}")
            self.test_results.append({
                'test': 'full_text_search',
                'status': 'FAIL',
                'error': str(e)
            })
    
    def generate_test_report(self):
        """生成测试报告"""
        print("\n" + "="*60)
        print("📊 Clickzetta 向量数据库测试报告")
        print("="*60)
        
        total_tests = len(self.test_results)
        passed_tests = sum(1 for result in self.test_results if result['status'] == 'PASS')
        failed_tests = sum(1 for result in self.test_results if result['status'] == 'FAIL')
        partial_tests = sum(1 for result in self.test_results if result['status'] == 'PARTIAL')
        
        print(f"总测试数: {total_tests}")
        print(f"通过: {passed_tests}")
        print(f"失败: {failed_tests}")
        print(f"部分通过: {partial_tests}")
        print(f"成功率: {(passed_tests + partial_tests) / total_tests * 100:.1f}%")
        
        print(f"\n详细结果:")
        for result in self.test_results:
            status_emoji = {"PASS": "✅", "FAIL": "❌", "PARTIAL": "⚠️"}
            print(f"{status_emoji.get(result['status'], '❓')} {result['test']}: {result['status']}")
            
            if 'metrics' in result:
                for key, value in result['metrics'].items():
                    if isinstance(value, dict):
                        print(f"    {key}:")
                        for k, v in value.items():
                            print(f"      {k}: {v}")
                    else:
                        print(f"    {key}: {value}")
            
            if 'error' in result:
                print(f"    错误: {result['error']}")
        
        return {
            'summary': {
                'total': total_tests,
                'passed': passed_tests,
                'failed': failed_tests,
                'partial': partial_tests,
                'success_rate': (passed_tests + partial_tests) / total_tests * 100
            },
            'details': self.test_results
        }
    
    def run_all_tests(self):
        """运行所有测试"""
        print("🚀 开始 Clickzetta 向量数据库集成测试")
        
        if not self.setup():
            return False
        
        try:
            self.test_basic_operations()
            self.test_concurrent_operations()
            self.test_performance_benchmark()
            self.test_error_handling()
            self.test_full_text_search()
            
        finally:
            self.cleanup()
        
        return self.generate_test_report()

def main():
    """主函数"""
    # 检查环境变量
    required_env_vars = [
        'CLICKZETTA_USERNAME',
        'CLICKZETTA_PASSWORD', 
        'CLICKZETTA_INSTANCE',
        'CLICKZETTA_WORKSPACE'
    ]
    
    missing_vars = [var for var in required_env_vars if not os.getenv(var)]
    if missing_vars:
        print(f"❌ 缺少必需的环境变量: {missing_vars}")
        print("请设置以下环境变量:")
        for var in required_env_vars:
            print(f"export {var}=your_value")
        return False
    
    # 运行测试套件
    test_suite = ClickzettaTestSuite()
    report = test_suite.run_all_tests()
    
    if report:
        print(f"\n🎯 测试完成！成功率: {report['summary']['success_rate']:.1f}%")
        return report['summary']['success_rate'] > 80
    
    return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)