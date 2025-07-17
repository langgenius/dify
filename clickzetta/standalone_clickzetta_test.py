#!/usr/bin/env python3
"""
Clickzetta 独立测试脚本

此脚本独立测试 Clickzetta 连接器的基础功能，不依赖 Dify 框架。
用于验证 Clickzetta 集成的核心功能是否正常工作。

运行要求:
- 设置正确的环境变量
- 安装 clickzetta-connector-python
- 确保能访问 Clickzetta 服务

作者: Claude Code Assistant
日期: 2025-07-17
"""

import json
import logging
import os
import random
import string
import threading
import time
import uuid
from typing import List, Dict, Any

try:
    import clickzetta
except ImportError:
    print("❌ 错误: 请安装 clickzetta-connector-python")
    print("   pip install clickzetta-connector-python>=0.8.102")
    exit(1)

try:
    import numpy as np
except ImportError:
    print("❌ 错误: 请安装 numpy")
    print("   pip install numpy")
    exit(1)

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class ClickzettaStandaloneTest:
    """Clickzetta 独立测试类"""
    
    def __init__(self):
        """初始化测试环境"""
        self.connection = None
        self.test_table = f"test_vectors_{int(time.time())}"
        self.test_schema = os.getenv("CLICKZETTA_SCHEMA", "dify")
        self.results = {}
        
        # 从环境变量获取配置
        self.config = {
            "username": os.getenv("CLICKZETTA_USERNAME"),
            "password": os.getenv("CLICKZETTA_PASSWORD"),
            "instance": os.getenv("CLICKZETTA_INSTANCE"),
            "service": os.getenv("CLICKZETTA_SERVICE", "api.clickzetta.com"),
            "workspace": os.getenv("CLICKZETTA_WORKSPACE", "quick_start"),
            "vcluster": os.getenv("CLICKZETTA_VCLUSTER", "default_ap"),
            "schema": self.test_schema
        }
        
        # 验证必需的配置
        required_keys = ["username", "password", "instance", "service", "workspace", "vcluster"]
        missing_keys = [key for key in required_keys if not self.config.get(key)]
        if missing_keys:
            raise ValueError(f"缺少必需的环境变量: {missing_keys}")
    
    def connect(self) -> bool:
        """测试数据库连接"""
        try:
            print("🔌 正在连接 Clickzetta...")
            self.connection = clickzetta.connect(
                username=self.config["username"],
                password=self.config["password"],
                instance=self.config["instance"],
                service=self.config["service"],
                workspace=self.config["workspace"],
                vcluster=self.config["vcluster"],
                schema=self.config["schema"]
            )
            print("✅ 连接成功")
            return True
        except Exception as e:
            print(f"❌ 连接失败: {e}")
            return False
    
    def test_table_operations(self) -> bool:
        """测试表操作"""
        print("\n🧪 测试表操作...")
        
        try:
            with self.connection.cursor() as cursor:
                # 创建测试表
                create_sql = f"""
                CREATE TABLE IF NOT EXISTS {self.test_schema}.{self.test_table} (
                    id STRING NOT NULL,
                    content STRING NOT NULL,
                    metadata JSON,
                    embedding VECTOR(FLOAT, 1536) NOT NULL,
                    PRIMARY KEY (id)
                )
                """
                cursor.execute(create_sql)
                print(f"✅ 表创建成功: {self.test_table}")
                
                # 准备测试数据
                test_data = []
                for i in range(5):
                    doc_id = str(uuid.uuid4())
                    content = f"测试文档 {i+1}: 这是一个用于测试向量搜索的示例文档。"
                    metadata = {
                        "doc_id": doc_id,
                        "document_id": f"doc_{i+1}",
                        "source": "test",
                        "created_at": time.time()
                    }
                    # 生成随机向量
                    embedding = np.random.random(1536).tolist()
                    test_data.append((doc_id, content, json.dumps(metadata), embedding))
                
                # 批量插入数据
                start_time = time.time()
                values = []
                for doc_id, content, metadata_json, embedding in test_data:
                    embedding_str = f"VECTOR({','.join(map(str, embedding))})"
                    escaped_content = content.replace("'", "''")
                    values.append(f"('{doc_id}', '{escaped_content}', "
                                f"JSON '{metadata_json}', {embedding_str})")
                
                insert_sql = f"""
                INSERT INTO {self.test_schema}.{self.test_table}
                (id, content, metadata, embedding)
                VALUES {','.join(values)}
                """
                cursor.execute(insert_sql)
                insert_time = time.time() - start_time
                
                print(f"✅ 数据插入成功: {len(test_data)} 条记录，耗时 {insert_time:.3f}秒")
                
                # 验证数据
                cursor.execute(f"SELECT COUNT(*) FROM {self.test_schema}.{self.test_table}")
                count = cursor.fetchone()[0]
                print(f"✅ 数据查询成功: 表中共有 {count} 条记录")
                
                self.results["table_operations"] = True
                return True
                
        except Exception as e:
            print(f"❌ 表操作测试失败: {e}")
            self.results["table_operations"] = False
            return False
    
    def test_vector_operations(self) -> bool:
        """测试向量操作"""
        print("\n🧪 测试向量操作...")
        
        try:
            with self.connection.cursor() as cursor:
                # 创建向量索引
                index_name = f"idx_{self.test_table}_vector"
                index_sql = f"""
                CREATE VECTOR INDEX IF NOT EXISTS {index_name}
                ON TABLE {self.test_schema}.{self.test_table}(embedding)
                PROPERTIES (
                    "distance.function" = "cosine_distance",
                    "scalar.type" = "f32",
                    "m" = "16",
                    "ef.construction" = "128"
                )
                """
                cursor.execute(index_sql)
                print("✅ 向量索引创建成功")
                
                # 测试向量搜索
                query_vector = np.random.random(1536).tolist()
                search_sql = f"""
                SELECT id, content, metadata,
                       COSINE_DISTANCE(embedding, VECTOR({','.join(map(str, query_vector))})) AS distance
                FROM {self.test_schema}.{self.test_table}
                ORDER BY distance
                LIMIT 3
                """
                
                start_time = time.time()
                cursor.execute(search_sql)
                results = cursor.fetchall()
                search_time = time.time() - start_time
                
                print(f"✅ 向量搜索成功: 返回 {len(results)} 个结果，耗时 {search_time*1000:.0f}ms")
                
                # 验证结果
                for i, row in enumerate(results):
                    metadata = json.loads(row[2]) if row[2] else {}
                    distance = row[3]
                    print(f"   结果 {i+1}: 距离={distance:.4f}, 文档={metadata.get('document_id', 'unknown')}")
                
                self.results["vector_operations"] = True
                return True
                
        except Exception as e:
            print(f"❌ 向量操作测试失败: {e}")
            self.results["vector_operations"] = False
            return False
    
    def test_concurrent_writes(self) -> bool:
        """测试并发写入"""
        print("\n🧪 测试并发写入...")
        
        def worker_thread(thread_id: int, doc_count: int) -> Dict[str, Any]:
            """工作线程函数"""
            try:
                # 每个线程使用独立连接
                worker_connection = clickzetta.connect(
                    username=self.config["username"],
                    password=self.config["password"],
                    instance=self.config["instance"],
                    service=self.config["service"],
                    workspace=self.config["workspace"],
                    vcluster=self.config["vcluster"],
                    schema=self.config["schema"]
                )
                
                start_time = time.time()
                successful_inserts = 0
                
                with worker_connection.cursor() as cursor:
                    for i in range(doc_count):
                        try:
                            doc_id = f"thread_{thread_id}_doc_{i}_{uuid.uuid4()}"
                            content = f"线程 {thread_id} 文档 {i+1}: 并发测试内容"
                            metadata = {
                                "thread_id": thread_id,
                                "doc_index": i,
                                "timestamp": time.time()
                            }
                            embedding = np.random.random(1536).tolist()
                            
                            embedding_str = f"VECTOR({','.join(map(str, embedding))})"
                            insert_sql = f"""
                            INSERT INTO {self.test_schema}.{self.test_table}
                            (id, content, metadata, embedding)
                            VALUES ('{doc_id}', '{content}', JSON '{json.dumps(metadata)}', {embedding_str})
                            """
                            cursor.execute(insert_sql)
                            successful_inserts += 1
                            
                            # 短暂延迟模拟真实场景
                            time.sleep(0.05)
                            
                        except Exception as e:
                            logger.warning(f"线程 {thread_id} 插入失败: {e}")
                
                elapsed_time = time.time() - start_time
                return {
                    "thread_id": thread_id,
                    "successful_inserts": successful_inserts,
                    "elapsed_time": elapsed_time,
                    "rate": successful_inserts / elapsed_time if elapsed_time > 0 else 0
                }
                
            except Exception as e:
                logger.error(f"线程 {thread_id} 执行失败: {e}")
                return {
                    "thread_id": thread_id,
                    "successful_inserts": 0,
                    "elapsed_time": 0,
                    "rate": 0,
                    "error": str(e)
                }
        
        try:
            # 启动多个工作线程
            num_threads = 3
            docs_per_thread = 15
            threads = []
            results = []
            
            print(f"启动 {num_threads} 个并发工作线程...")
            start_time = time.time()
            
            # 创建并启动线程
            for i in range(num_threads):
                thread = threading.Thread(
                    target=lambda tid=i: results.append(worker_thread(tid, docs_per_thread))
                )
                threads.append(thread)
                thread.start()
            
            # 等待所有线程完成
            for thread in threads:
                thread.join()
            
            total_time = time.time() - start_time
            
            # 统计结果
            total_docs = sum(r.get("successful_inserts", 0) for r in results)
            successful_threads = len([r for r in results if r.get("successful_inserts", 0) > 0])
            overall_rate = total_docs / total_time if total_time > 0 else 0
            
            print(f"✅ 并发写入测试完成:")
            print(f"  - 总耗时: {total_time:.2f} 秒")
            print(f"  - 成功线程: {successful_threads}/{num_threads}")
            print(f"  - 总文档数: {total_docs}")
            print(f"  - 整体速率: {overall_rate:.1f} docs/sec")
            
            # 详细结果
            for result in results:
                if "error" in result:
                    print(f"  - 线程 {result['thread_id']}: 失败 - {result['error']}")
                else:
                    print(f"  - 线程 {result['thread_id']}: {result['successful_inserts']} 文档, "
                          f"{result['rate']:.1f} docs/sec")
            
            self.results["concurrent_writes"] = successful_threads >= num_threads * 0.8  # 80% 成功率
            return self.results["concurrent_writes"]
            
        except Exception as e:
            print(f"❌ 并发写入测试失败: {e}")
            self.results["concurrent_writes"] = False
            return False
    
    def cleanup(self) -> None:
        """清理测试数据"""
        try:
            if self.connection:
                with self.connection.cursor() as cursor:
                    cursor.execute(f"DROP TABLE IF EXISTS {self.test_schema}.{self.test_table}")
                print("✅ 清理完成")
        except Exception as e:
            print(f"⚠️ 清理警告: {e}")
    
    def run_all_tests(self) -> None:
        """运行所有测试"""
        print("🚀 Clickzetta 独立测试开始")
        print(f"📋 测试配置:")
        print(f"  - 服务: {self.config['service']}")
        print(f"  - 实例: {self.config['instance']}")
        print(f"  - 工作空间: {self.config['workspace']}")
        print(f"  - 模式: {self.config['schema']}")
        print(f"  - 测试表: {self.test_table}")
        print()
        
        try:
            # 1. 连接测试
            if not self.connect():
                return
            
            # 2. 表操作测试
            self.test_table_operations()
            
            # 3. 向量操作测试
            self.test_vector_operations()
            
            # 4. 并发写入测试
            self.test_concurrent_writes()
            
            # 5. 生成测试报告
            self.generate_report()
            
        finally:
            # 清理
            self.cleanup()
    
    def generate_report(self) -> None:
        """生成测试报告"""
        print("\n📊 测试报告:")
        
        total_tests = len(self.results)
        passed_tests = sum(1 for passed in self.results.values() if passed)
        
        for test_name, passed in self.results.items():
            status = "✅ 通过" if passed else "❌ 失败"
            print(f"  - {test_name}: {status}")
        
        success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
        print(f"\n🎯 总体结果: {passed_tests}/{total_tests} 通过 ({success_rate:.1f}%)")
        
        if success_rate >= 80:
            print("🎉 测试总体成功！Clickzetta 集成准备就绪。")
        else:
            print("⚠️ 部分测试失败，需要进一步调试。")


def main():
    """主函数"""
    try:
        test = ClickzettaStandaloneTest()
        test.run_all_tests()
    except KeyboardInterrupt:
        print("\n🛑 测试被用户中断")
    except Exception as e:
        print(f"\n❌ 测试执行失败: {e}")
        logger.exception("详细错误信息:")


if __name__ == "__main__":
    main()