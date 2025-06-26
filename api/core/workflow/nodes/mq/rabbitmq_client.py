import json
import logging
import threading
import time
from typing import Any, Optional

import pika
from pika.exceptions import AMQPChannelError, AMQPConnectionError, StreamLostError

from configs import dify_config

logger = logging.getLogger(__name__)

class RabbitMQClient:
    """
    RabbitMQ客户端，实现自动重连和连接管理
    """

    def __init__(self, queue_name: str):
        self.queue_name = queue_name
        self._connection_params = self._get_connection_params()
        self._stopping = False
        self._lock = threading.Lock()
        self._local = threading.local()
        self._reconnect_delay = 1  # 初始重连延迟（秒）
        self._max_reconnect_delay = 30  # 最大重连延迟（秒）

    def _get_connection_params(self) -> pika.ConnectionParameters:
        """获取RabbitMQ连接参数"""
        RABBITMQ_CONFIG = {
            'host': dify_config.MQ_HOST,
            'port': 5672,
            'username': 'apitable',
            'password': 'apitable@com',
            'virtual_host': '/'
        }
        print('MQ_HOST:' + RABBITMQ_CONFIG['host'])
        print('virtual_host:' + RABBITMQ_CONFIG['virtual_host'])
        return pika.ConnectionParameters(
            host=RABBITMQ_CONFIG['host'],
            port=RABBITMQ_CONFIG['port'],
            virtual_host=RABBITMQ_CONFIG['virtual_host'],
            credentials=pika.PlainCredentials(
                username=RABBITMQ_CONFIG['username'],
                password=RABBITMQ_CONFIG['password']
            ),
            heartbeat=30,  # 心跳超时时间
            connection_attempts=3,  # 连接尝试次数
            retry_delay=5,  # 重试延迟
            socket_timeout=10,  # socket超时
            blocked_connection_timeout=300,  # 阻塞连接超时
            client_properties={'connection_name': f'spider_client_{threading.get_ident()}'}  # 添加线程标识
        )

    def _get_connection(self):
        """获取当前线程的连接"""
        if not hasattr(self._local, 'connection') or not self._local.connection or self._local.connection.is_closed:
            self._local.connection = pika.BlockingConnection(self._connection_params)
        return self._local.connection

    def _get_channel(self):
        """获取当前线程的通道"""
        if not hasattr(self._local, 'channel') or not self._local.channel or self._local.channel.is_closed:
            connection = self._get_connection()
            self._local.channel = connection.channel()
            self._local.channel.queue_declare(queue=self.queue_name, durable=True)
            self._local.channel.confirm_delivery()
        return self._local.channel

    def _ensure_connection(self) -> bool:
        """
        确保RabbitMQ连接和通道可用

        Returns:
            bool: 连接是否成功
        """
        try:
            self._get_channel()
            return True
        except Exception as e:
            # logger.exception(f"RabbitMQ连接失败: {str(e)}")
            # 使用指数退避策略
            time.sleep(self._reconnect_delay)
            self._reconnect_delay = min(self._reconnect_delay * 2, self._max_reconnect_delay)
            return False

    def publish_json(self, message: dict[str, Any], max_retries: int = 3) -> bool:
        """
        发布任意JSON消息到队列

        Args:
            message: 要发送的消息字典
            max_retries: 最大重试次数

        Returns:
            bool: 发送是否成功
        """
        retries = 0
        while retries < max_retries and not self._stopping:
            try:
                channel = self._get_channel()

                # 发布消息并等待确认
                channel.basic_publish(
                    exchange='',
                    routing_key=self.queue_name,
                    body=json.dumps(message),
                    properties=pika.BasicProperties(
                        delivery_mode=2,  # 消息持久化
                        content_type='application/json'
                    ),
                    mandatory=True  # 确保消息能够被路由
                )
                logger.info(f"消息发送成功: {message}")
                self._reconnect_delay = 1  # 重置重连延迟
                return True

            except (AMQPConnectionError, AMQPChannelError, StreamLostError) as e:
                # logger.exception(f"发送消息失败 (尝试 {retries + 1}/{max_retries}): {str(e)}")
                # 清除当前线程的连接和通道
                if hasattr(self._local, 'channel'):
                    delattr(self._local, 'channel')
                if hasattr(self._local, 'connection'):
                    delattr(self._local, 'connection')
                retries += 1
                if retries < max_retries:
                    time.sleep(self._reconnect_delay)
            except Exception as e:
                # logger.exception(f"发送消息时发生未知错误: {str(e)}")
                return False

        return False

    def publish_message(self, task_id: str, action: str, status: Optional[str] = None,
                        extra: Optional[str] = None, reason: Optional[str] = None) -> bool:
        """
        发布任务状态更新消息

        Args:
            task_id: 任务ID
            action: 动作类型
            status: 状态（FINISHED或EXCEPTION）
            extra: 额外信息（字符串）
            reason: 原因（异常时使用）

        Returns:
            bool: 是否发送成功
        """
        message = {
            "taskId": task_id,
            "action": action
        }

        if status:
            message["status"] = status
        if extra:
            message["extra"] = extra  # 直接设置字符串
        if reason:
            message["reason"] = reason[:500] if reason else None  # 限制reason长度

        return self.publish_json(message)

    def close(self) -> None:
        """关闭连接"""
        self._stopping = True
        if hasattr(self._local, 'channel') and self._local.channel and not self._local.channel.is_closed:
            try:
                self._local.channel.close()
            except Exception as e:
                logger.info(f"关闭通道时发生错误: {str(e)}")

        if hasattr(self._local, 'connection') and self._local.connection and not self._local.connection.is_closed:
            try:
                self._local.connection.close()
            except Exception as e:
                logger.info(f"关闭连接时发生错误: {str(e)}")

        logger.info("RabbitMQ连接已关闭")
