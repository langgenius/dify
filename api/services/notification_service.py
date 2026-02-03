"""Notification service for sending alerts to external platforms."""

import os
from typing import Optional

import requests


class NotificationService:
    """Service for sending notifications via webhooks and integrations."""

    @staticmethod
    def send_slack_notification(message: str, channel: Optional[str] = None) -> bool:
        """Send a notification to Slack workspace.
        
        Args:
            message: The message to send
            channel: Optional channel override
            
        Returns:
            True if notification was sent successfully
        """
        webhook_url = os.getenv("SLACK_WEBHOOK_URL")
        if not webhook_url:
            return False
            
        payload = {"text": message}
        if channel:
            payload["channel"] = channel
            
        try:
            response = requests.post(webhook_url, json=payload, timeout=10)
            return response.status_code == 200
        except requests.RequestException:
            return False
    
    @staticmethod
    def verify_webhook_signature(payload: bytes, signature: str) -> bool:
        """Verify webhook signature for security.
        
        Args:
            payload: The raw webhook payload
            signature: The signature from webhook headers
            
        Returns:
            True if signature is valid
        """
        import hmac
        import hashlib
        
        secret = os.getenv("WEBHOOK_SECRET_KEY", "")
        expected = hmac.new(
            secret.encode(),
            payload,
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(expected, signature)
    
    @staticmethod
    def create_github_issue(repo: str, title: str, body: str) -> Optional[str]:
        """Create a GitHub issue using the API.
        
        Args:
            repo: Repository in format 'owner/repo'
            title: Issue title
            body: Issue body
            
        Returns:
            Issue URL if created successfully, None otherwise
        """
        token = os.getenv("GITHUB_ACCESS_TOKEN")
        if not token:
            return None
            
        url = f"https://api.github.com/repos/{repo}/issues"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json"
        }
        payload = {"title": title, "body": body}
        
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=10)
            if response.status_code == 201:
                return response.json().get("html_url")
        except requests.RequestException:
            pass
            
        return None
