import datetime
import logging

import stripe
from flask import current_app

from core.model_providers.model_provider_factory import ModelProviderFactory
from extensions.ext_database import db
from models.account import Account
from models.provider import ProviderOrder, ProviderOrderPaymentStatus, ProviderType, Provider, ProviderQuotaType


class ProviderCheckout:
    def __init__(self, stripe_checkout_session):
        self.stripe_checkout_session = stripe_checkout_session

    def get_checkout_url(self):
        return self.stripe_checkout_session.url


class ProviderCheckoutService:
    def create_checkout(self, tenant_id: str, provider_name: str, account: Account) -> ProviderCheckout:
        # check provider name is valid
        model_provider_rules = ModelProviderFactory.get_provider_rules()
        if provider_name not in model_provider_rules:
            raise ValueError(f'provider name {provider_name} is invalid')

        model_provider_rule = model_provider_rules[provider_name]

        # check provider name can be paid
        self._check_provider_payable(provider_name, model_provider_rule)

        # get stripe checkout product id
        paid_provider = self._get_paid_provider(tenant_id, provider_name)
        model_provider_class = ModelProviderFactory.get_model_provider_class(provider_name)
        model_provider = model_provider_class(provider=paid_provider)
        payment_info = model_provider.get_payment_info()
        if not payment_info:
            raise ValueError(f'provider name {provider_name} not support payment')

        payment_product_id = payment_info['product_id']
        payment_min_quantity = payment_info['min_quantity']
        payment_max_quantity = payment_info['max_quantity']

        # create provider order
        provider_order = ProviderOrder(
            tenant_id=tenant_id,
            provider_name=provider_name,
            account_id=account.id,
            payment_product_id=payment_product_id,
            quantity=1,
            payment_status=ProviderOrderPaymentStatus.WAIT_PAY.value
        )

        db.session.add(provider_order)
        db.session.flush()

        line_item = {
            'price': f'{payment_product_id}',
            'quantity': payment_min_quantity
        }

        if payment_min_quantity > 1 and payment_max_quantity != payment_min_quantity:
            line_item['adjustable_quantity'] = {
                'enabled': True,
                'minimum': payment_min_quantity,
                'maximum': payment_max_quantity
            }

        try:
            # create stripe checkout session
            checkout_session = stripe.checkout.Session.create(
                line_items=[
                    line_item
                ],
                mode='payment',
                success_url=current_app.config.get("CONSOLE_WEB_URL")
                            + f'?provider_name={provider_name}&payment_result=succeeded',
                cancel_url=current_app.config.get("CONSOLE_WEB_URL")
                           + f'?provider_name={provider_name}&payment_result=cancelled',
                automatic_tax={'enabled': True},
            )
        except Exception as e:
            logging.exception(e)
            raise ValueError(f'provider name {provider_name} create checkout session failed, please try again later')

        provider_order.payment_id = checkout_session.id
        db.session.commit()

        return ProviderCheckout(checkout_session)

    def fulfill_provider_order(self, event, line_items):
        provider_order = db.session.query(ProviderOrder) \
            .filter(ProviderOrder.payment_id == event['data']['object']['id']) \
            .first()

        if not provider_order:
            raise ValueError(f'provider order not found, payment id: {event["data"]["object"]["id"]}')

        if provider_order.payment_status != ProviderOrderPaymentStatus.WAIT_PAY.value:
            raise ValueError(
                f'provider order payment status is not wait pay, payment id: {event["data"]["object"]["id"]}')

        provider_order.transaction_id = event['data']['object']['payment_intent']
        provider_order.currency = event['data']['object']['currency']
        provider_order.total_amount = event['data']['object']['amount_subtotal']
        provider_order.payment_status = ProviderOrderPaymentStatus.PAID.value
        provider_order.paid_at = datetime.datetime.utcnow()
        provider_order.updated_at = provider_order.paid_at

        # update provider quota
        provider = db.session.query(Provider).filter(
            Provider.tenant_id == provider_order.tenant_id,
            Provider.provider_name == provider_order.provider_name,
            Provider.provider_type == ProviderType.SYSTEM.value,
            Provider.quota_type == ProviderQuotaType.PAID.value
        ).first()

        if not provider:
            raise ValueError(f'provider not found, tenant id: {provider_order.tenant_id}, '
                             f'provider name: {provider_order.provider_name}')

        model_provider_class = ModelProviderFactory.get_model_provider_class(provider_order.provider_name)
        model_provider = model_provider_class(provider=provider)
        payment_info = model_provider.get_payment_info()

        quantity = line_items['data'][0]['quantity']

        if not payment_info:
            increase_quota = 0
        else:
            increase_quota = int(payment_info['increase_quota']) * quantity

        if increase_quota > 0:
            provider.quota_limit += increase_quota
            provider.is_valid = True

        db.session.commit()

    def _check_provider_payable(self, provider_name: str, model_provider_rule: dict):
        if ProviderType.SYSTEM.value not in model_provider_rule['support_provider_types']:
            raise ValueError(f'provider name {provider_name} not support payment')

        if 'system_config' not in model_provider_rule:
            raise ValueError(f'provider name {provider_name} not support payment')

        if 'supported_quota_types' not in model_provider_rule['system_config']:
            raise ValueError(f'provider name {provider_name} not support payment')

        if 'paid' not in model_provider_rule['system_config']['supported_quota_types']:
            raise ValueError(f'provider name {provider_name} not support payment')

    def _get_paid_provider(self, tenant_id: str, provider_name: str):
        paid_provider = db.session.query(Provider) \
            .filter(
            Provider.tenant_id == tenant_id,
            Provider.provider_name == provider_name,
            Provider.provider_type == ProviderType.SYSTEM.value,
            Provider.quota_type == ProviderQuotaType.PAID.value,
        ).first()

        if not paid_provider:
            paid_provider = Provider(
                tenant_id=tenant_id,
                provider_name=provider_name,
                provider_type=ProviderType.SYSTEM.value,
                quota_type=ProviderQuotaType.PAID.value,
                quota_limit=0,
                quota_used=0,
            )
            db.session.add(paid_provider)
            db.session.commit()

        return paid_provider
