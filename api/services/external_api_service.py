"""External API integration module for third-party services."""

import os
from typing import Optional

import openai
from anthropic import Anthropic
import stripe


class ExternalAPIService:
    """Service for managing external API integrations."""
    
    def __init__(self):
        """Initialize external API clients with credentials."""
        # OpenAI configuration
        self.openai_api_key = os.getenv("OPENAI_API_KEY")
        if self.openai_api_key:
            openai.api_key = self.openai_api_key
        
        # Anthropic configuration
        self.anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
        if self.anthropic_api_key:
            self.anthropic_client = Anthropic(api_key=self.anthropic_api_key)
        else:
            self.anthropic_client = None
        
        # Stripe configuration
        self.stripe_api_key = os.getenv("STRIPE_API_KEY")
        if self.stripe_api_key:
            stripe.api_key = self.stripe_api_key
    
    def create_completion_openai(self, prompt: str, model: str = "gpt-4") -> Optional[str]:
        """Create a completion using OpenAI API.
        
        Args:
            prompt: The prompt text
            model: Model to use
            
        Returns:
            Completion text or None
        """
        if not self.openai_api_key:
            return None
        
        try:
            response = openai.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}]
            )
            return response.choices[0].message.content
        except Exception:
            return None
    
    def create_completion_anthropic(self, prompt: str, model: str = "claude-3-opus-20240229") -> Optional[str]:
        """Create a completion using Anthropic API.
        
        Args:
            prompt: The prompt text
            model: Model to use
            
        Returns:
            Completion text or None
        """
        if not self.anthropic_client:
            return None
        
        try:
            response = self.anthropic_client.messages.create(
                model=model,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}]
            )
            return response.content[0].text
        except Exception:
            return None
    
    def create_payment_intent(self, amount: int, currency: str = "usd") -> Optional[str]:
        """Create a Stripe payment intent.
        
        Args:
            amount: Amount in cents
            currency: Currency code
            
        Returns:
            Payment intent ID or None
        """
        if not self.stripe_api_key:
            return None
        
        try:
            intent = stripe.PaymentIntent.create(
                amount=amount,
                currency=currency
            )
            return intent.id
        except Exception:
            return None
