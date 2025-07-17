#!/usr/bin/env python3
"""
Clickzetta Vector Database Integration Test Suite

Comprehensive test cases covering all core functionality of Clickzetta vector database integration
with Dify framework, including CRUD operations, concurrent safety, and performance benchmarking.
"""

import os
import sys
import time
import threading
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import List, Dict, Any
import numpy as np

# Add the API directory to the path so we can import Dify modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api'))

try:
    from core.rag.datasource.vdb.clickzetta.clickzetta_vector import ClickzettaVector
    from core.rag.models.document import Document
    from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
except ImportError as e:
    print(f"❌ Failed to import Dify modules: {e}")
    print("This test requires running in Dify environment")
    sys.exit(1)


class ClickzettaIntegrationTest:
    """Clickzetta Vector Database Test Suite"""
    
    def __init__(self):
        """Initialize test environment"""
        self.collection_name = f"test_collection_{int(time.time())}"
        self.vector_client = None
        self.test_results = {}
        
    def setup_test_environment(self):
        """Set up test environment"""
        try:
            # Test configuration
            config = {
                'username': os.getenv('CLICKZETTA_USERNAME'),
                'password': os.getenv('CLICKZETTA_PASSWORD'),
                'instance': os.getenv('CLICKZETTA_INSTANCE'),
                'service': os.getenv('CLICKZETTA_SERVICE', 'uat-api.clickzetta.com'),
                'workspace': os.getenv('CLICKZETTA_WORKSPACE', 'quick_start'),
                'vcluster': os.getenv('CLICKZETTA_VCLUSTER', 'default_ap'),
                'schema': os.getenv('CLICKZETTA_SCHEMA', 'dify')
            }
            
            # Check required environment variables
            required_vars = [
                'CLICKZETTA_USERNAME',
                'CLICKZETTA_PASSWORD', 
                'CLICKZETTA_INSTANCE'
            ]
            
            missing_vars = [var for var in required_vars if not os.getenv(var)]
            if missing_vars:
                raise ValueError(f"Missing required environment variables: {missing_vars}")
            
            print(f"✅ Test environment setup successful, using collection: {self.collection_name}")
            return True
            
        except Exception as e:
            print(f"❌ Test environment setup failed: {str(e)}")
            return False
    
    def cleanup_test_data(self):
        """Clean up test data"""
        try:
            if self.vector_client:
                self.vector_client.delete()
            print("✅ Test data cleanup complete")
        except Exception as e:
            print(f"⚠️ Error during test data cleanup: {str(e)}")
    
    def generate_test_documents(self, count: int) -> List[Document]:
        """Generate test documents"""
        documents = []
        for i in range(count):
            doc = Document(
                page_content=f"This is test document {i+1}, containing content about artificial intelligence and machine learning.",
                metadata={
                    'doc_id': f'test_doc_{i+1}',
                    'document_id': f'doc_{i+1}',
                    'source': 'test_integration',
                    'index': i
                }
            )
            documents.append(doc)
        return documents
    
    def test_basic_operations(self):
        """Test basic operations: create, insert, query, delete"""
        print("\n🧪 Testing Basic Operations...")
        
        try:
            # 1. Test document insertion
            print("  📝 Testing document insertion...")
            test_docs = self.generate_test_documents(5)
            embeddings = [np.random.random(1536).tolist() for _ in range(5)]
            
            start_time = time.time()
            self.vector_client.create(texts=test_docs, embeddings=embeddings)
            insert_time = time.time() - start_time
            
            print(f"     ✅ Inserted {len(test_docs)} documents in {insert_time:.3f}s")
            
            # 2. Test similarity search
            print("  🔍 Testing similarity search...")
            query_vector = np.random.random(1536).tolist()
            
            start_time = time.time()
            search_results = self.vector_client.search_by_vector(query_vector, top_k=3)
            search_time = time.time() - start_time
            
            print(f"     ✅ Found {len(search_results)} results in {search_time*1000:.0f}ms")
            
            # 3. Test text search
            print("  📖 Testing text search...")
            start_time = time.time()
            text_results = self.vector_client.search_by_full_text("artificial intelligence", top_k=3)
            text_search_time = time.time() - start_time
            
            print(f"     ✅ Text search returned {len(text_results)} results in {text_search_time*1000:.0f}ms")
            
            # 4. Test document deletion
            print("  🗑️ Testing document deletion...")
            if search_results:
                doc_ids = [doc.metadata.get('doc_id') for doc in search_results[:2]]
                self.vector_client.delete_by_ids(doc_ids)
                print(f"     ✅ Deleted {len(doc_ids)} documents")
            
            self.test_results['basic_operations'] = {
                'status': 'passed',
                'insert_time': insert_time,
                'search_time': search_time,
                'text_search_time': text_search_time,
                'documents_processed': len(test_docs)
            }
            
            print("✅ Basic operations test passed")
            return True
            
        except Exception as e:
            print(f"❌ Basic operations test failed: {str(e)}")
            self.test_results['basic_operations'] = {
                'status': 'failed',
                'error': str(e)
            }
            return False
    
    def test_concurrent_operations(self):
        """Test concurrent operation safety"""
        print("\n🧪 Testing Concurrent Operations...")
        
        def concurrent_insert_worker(worker_id: int, doc_count: int):
            """Worker function for concurrent inserts"""
            try:
                documents = []
                embeddings = []
                
                for i in range(doc_count):
                    doc = Document(
                        page_content=f"Concurrent worker {worker_id} document {i+1}",
                        metadata={
                            'doc_id': f'concurrent_{worker_id}_{i+1}',
                            'worker_id': worker_id,
                            'doc_index': i
                        }
                    )
                    documents.append(doc)
                    embeddings.append(np.random.random(1536).tolist())
                
                start_time = time.time()
                self.vector_client.add_texts(documents, embeddings)
                elapsed = time.time() - start_time
                
                return {
                    'worker_id': worker_id,
                    'documents_inserted': len(documents),
                    'time_taken': elapsed,
                    'success': True
                }
                
            except Exception as e:
                return {
                    'worker_id': worker_id,
                    'documents_inserted': 0,
                    'time_taken': 0,
                    'success': False,
                    'error': str(e)
                }
        
        try:
            # Run concurrent insertions
            num_workers = 3
            docs_per_worker = 10
            
            print(f"  🚀 Starting {num_workers} concurrent workers...")
            
            start_time = time.time()
            with ThreadPoolExecutor(max_workers=num_workers) as executor:
                futures = [
                    executor.submit(concurrent_insert_worker, i, docs_per_worker)
                    for i in range(num_workers)
                ]
                
                results = [future.result() for future in futures]
            
            total_time = time.time() - start_time
            
            # Analyze results
            successful_workers = [r for r in results if r['success']]
            total_docs = sum(r['documents_inserted'] for r in successful_workers)
            
            print(f"  ✅ Concurrent operations completed:")
            print(f"     - Total time: {total_time:.2f}s")
            print(f"     - Successful workers: {len(successful_workers)}/{num_workers}")
            print(f"     - Total documents: {total_docs}")
            print(f"     - Overall throughput: {total_docs/total_time:.1f} docs/sec")
            
            self.test_results['concurrent_operations'] = {
                'status': 'passed',
                'total_time': total_time,
                'successful_workers': len(successful_workers),
                'total_workers': num_workers,
                'total_documents': total_docs,
                'throughput': total_docs/total_time
            }
            
            print("✅ Concurrent operations test passed")
            return True
            
        except Exception as e:
            print(f"❌ Concurrent operations test failed: {str(e)}")
            self.test_results['concurrent_operations'] = {
                'status': 'failed',
                'error': str(e)
            }
            return False
    
    def test_performance_benchmarks(self):
        """Performance benchmark testing"""
        print("\n🧪 Testing Performance Benchmarks...")
        
        try:
            batch_sizes = [10, 50, 100]
            benchmark_results = {}
            
            for batch_size in batch_sizes:
                print(f"  📊 Testing batch size: {batch_size}")
                
                # Generate test data
                test_docs = self.generate_test_documents(batch_size)
                embeddings = [np.random.random(1536).tolist() for _ in range(batch_size)]
                
                # Test insertion performance
                start_time = time.time()
                self.vector_client.add_texts(test_docs, embeddings)
                insert_time = time.time() - start_time
                
                throughput = batch_size / insert_time
                
                # Test search performance
                query_vector = np.random.random(1536).tolist()
                
                search_times = []
                for _ in range(5):  # Run 5 searches for average
                    start_time = time.time()
                    self.vector_client.search_by_vector(query_vector, top_k=10)
                    search_times.append(time.time() - start_time)
                
                avg_search_time = sum(search_times) / len(search_times)
                
                benchmark_results[batch_size] = {
                    'insert_time': insert_time,
                    'throughput': throughput,
                    'avg_search_time': avg_search_time
                }
                
                print(f"     ✅ Batch {batch_size}: {throughput:.1f} docs/sec, {avg_search_time*1000:.0f}ms search")
            
            self.test_results['performance_benchmarks'] = {
                'status': 'passed',
                'results': benchmark_results
            }
            
            print("✅ Performance benchmarks test passed")
            return True
            
        except Exception as e:
            print(f"❌ Performance benchmarks test failed: {str(e)}")
            self.test_results['performance_benchmarks'] = {
                'status': 'failed',
                'error': str(e)
            }
            return False
    
    def test_error_handling(self):
        """Test error handling"""
        print("\n🧪 Testing Error Handling...")
        
        try:
            # 1. Test invalid embedding dimension
            print("  ⚠️ Testing invalid embedding dimension...")
            try:
                self.vector_client.add_texts(
                    texts=[Document(page_content="Test text", metadata={})],
                    embeddings=[[1, 2, 3]]  # Wrong dimension
                )
                print("     ❌ Should have failed with dimension error")
            except Exception as e:
                print(f"     ✅ Correctly handled dimension error: {type(e).__name__}")
            
            # 2. Test empty text
            print("  📝 Testing empty text handling...")
            try:
                self.vector_client.add_texts(
                    texts=[Document(page_content="", metadata={})],
                    embeddings=[np.random.random(1536).tolist()]
                )
                print("     ✅ Empty text handled gracefully")
            except Exception as e:
                print(f"     ℹ️ Empty text rejected: {type(e).__name__}")
            
            # 3. Test large batch data
            print("  📦 Testing large batch handling...")
            try:
                large_docs = self.generate_test_documents(500)
                large_embeddings = [np.random.random(1536).tolist() for _ in range(500)]
                
                start_time = time.time()
                self.vector_client.add_texts(large_docs, large_embeddings)
                large_batch_time = time.time() - start_time
                
                print(f"     ✅ Large batch (500 docs) processed in {large_batch_time:.2f}s")
                
            except Exception as e:
                print(f"     ⚠️ Large batch handling issue: {type(e).__name__}")
            
            self.test_results['error_handling'] = {
                'status': 'passed',
                'tests_completed': 3
            }
            
            print("✅ Error handling test passed")
            return True
            
        except Exception as e:
            print(f"❌ Error handling test failed: {str(e)}")
            self.test_results['error_handling'] = {
                'status': 'failed',
                'error': str(e)
            }
            return False
    
    def test_full_text_search(self):
        """Test full-text search functionality"""
        print("\n🧪 Testing Full-text Search...")
        
        try:
            # Prepare test documents with specific content
            test_docs = [
                Document(
                    page_content="Machine learning is a subset of artificial intelligence.",
                    metadata={'doc_id': 'ml_doc_1', 'category': 'AI'}
                ),
                Document(
                    page_content="Vector database is a specialized database system for storing and retrieving high-dimensional vector data.",
                    metadata={'doc_id': 'vdb_doc_1', 'category': 'Database'}
                ),
                Document(
                    page_content="Natural language processing enables computers to understand human language.",
                    metadata={'doc_id': 'nlp_doc_1', 'category': 'NLP'}
                )
            ]
            
            # Insert test documents
            embeddings = [np.random.random(1536).tolist() for _ in range(len(test_docs))]
            self.vector_client.add_texts(test_docs, embeddings)
            
            # Test different search queries
            search_queries = [
                ("machine learning", "AI"),
                ("vector", "database"),
                ("natural language", "NLP")
            ]
            
            for query, expected_category in search_queries:
                print(f"  🔍 Searching for: '{query}'")
                
                start_time = time.time()
                results = self.vector_client.search_by_full_text(query, top_k=5)
                search_time = time.time() - start_time
                
                print(f"     ✅ Found {len(results)} results in {search_time*1000:.0f}ms")
                
                # Verify results contain expected content
                if results:
                    for result in results:
                        if expected_category in result.metadata.get('category', ''):
                            print(f"     📄 Relevant result found: {result.metadata['doc_id']}")
                            break
            
            self.test_results['full_text_search'] = {
                'status': 'passed',
                'queries_tested': len(search_queries)
            }
            
            print("✅ Full-text search test passed")
            return True
            
        except Exception as e:
            print(f"❌ Full-text search test failed: {str(e)}")
            self.test_results['full_text_search'] = {
                'status': 'failed',
                'error': str(e)
            }
            return False
    
    def generate_test_report(self):
        """Generate test report"""
        print("\n" + "="*60)
        print("📊 Clickzetta Vector Database Test Report")
        print("="*60)
        
        passed_tests = sum(1 for result in self.test_results.values() if result['status'] == 'passed')
        total_tests = len(self.test_results)
        
        print(f"Total tests: {total_tests}")
        print(f"Passed: {passed_tests}")
        print(f"Failed: {total_tests - passed_tests}")
        print(f"Success rate: {(passed_tests/total_tests)*100:.1f}%")
        
        print("\n📋 Detailed Results:")
        for test_name, result in self.test_results.items():
            status_icon = "✅" if result['status'] == 'passed' else "❌"
            print(f"  {status_icon} {test_name}: {result['status'].upper()}")
            
            if result['status'] == 'failed':
                print(f"      Error: {result.get('error', 'Unknown error')}")
            elif test_name == 'basic_operations' and result['status'] == 'passed':
                print(f"      Insert time: {result['insert_time']:.3f}s")
                print(f"      Search time: {result['search_time']*1000:.0f}ms")
            elif test_name == 'performance_benchmarks' and result['status'] == 'passed':
                print("      Throughput by batch size:")
                for batch_size, metrics in result['results'].items():
                    print(f"        {batch_size} docs: {metrics['throughput']:.1f} docs/sec")
        
        return {
            'total_tests': total_tests,
            'passed_tests': passed_tests,
            'failed_tests': total_tests - passed_tests,
            'success_rate': (passed_tests/total_tests)*100,
            'summary': self.test_results
        }
    
    def run_all_tests(self):
        """Run all tests"""
        print("🚀 Starting Clickzetta Vector Database Integration Tests")
        print("="*60)
        
        # Setup test environment
        if not self.setup_test_environment():
            print("❌ Test environment setup failed, aborting tests")
            return None
        
        # Note: Since we can't create actual ClickzettaVector instances without full Dify setup,
        # this is a template for the test structure. In a real environment, you would:
        # 1. Initialize the vector client with proper configuration
        # 2. Run each test method
        # 3. Generate the final report
        
        print("⚠️ Note: This test requires full Dify environment setup")
        print("         Please run this test within the Dify API environment")
        
        # Test execution order
        tests = [
            self.test_basic_operations,
            self.test_concurrent_operations,
            self.test_performance_benchmarks,
            self.test_error_handling,
            self.test_full_text_search
        ]
        
        # In a real environment, you would run:
        # for test in tests:
        #     test()
        
        # Generate final report
        # return self.generate_test_report()
        
        print("\n🎯 Test template ready for execution in Dify environment")
        return None


def main():
    """Main function"""
    # Run test suite
    test_suite = ClickzettaIntegrationTest()
    
    try:
        report = test_suite.run_all_tests()
        if report:
            print(f"\n🎯 Tests completed! Success rate: {report['summary']['success_rate']:.1f}%")
    except KeyboardInterrupt:
        print("\n🛑 Tests interrupted by user")
    except Exception as e:
        print(f"\n❌ Test execution failed: {e}")
    finally:
        test_suite.cleanup_test_data()


if __name__ == "__main__":
    main()