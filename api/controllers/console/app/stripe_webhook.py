import os 
import json
from flask import request, jsonify
from flask_restful import Resource
from controllers.console import api
from extensions.ext_database import db
from models.account import BasePlan , TenantPlan , Transaction , Tenant
from datetime import datetime
import stripe


class StripeWebhookApi(Resource):

    stripe.api_key = os.getenv('STRIPE_SECRET_KEY')
    
    def post(self):
        webhook_secret = os.getenv('STRIPE_WEBHOOK_SECRET') 
        request_data = json.loads(request.data)

        try:
            if webhook_secret:
                signature = request.headers.get('stripe-signature')
                event = stripe.Webhook.construct_event(
                    payload=request.data, sig_header=signature, secret=webhook_secret)
                data = event['data']
            else:
                data = request_data['data']
                event = request_data
            
            event_type = event['type']
            data_object = data['object']

            if event_type == 'checkout.session.completed':
                print('checkout session start  ------------------------------------------------------')
                self.handle_checkout_session_completed(data_object)
                print('checkout session end ------------------------------------------------------')
            elif event_type == 'invoice.paid':
                print('invoice paid start  ------------------------------------------------------')
                self.handle_invoice_paid(data_object)
                print('invoice paid end ------------------------------------------------------')
            elif event_type == 'invoice.payment_failed':
                print('invoice payment failed start  ------------------------------------------------------')
                self.handle_invoice_payment_failed(data_object)
                print('invoice payment failed end ------------------------------------------------------')
            elif event_type == 'customer.subscription.updated':
                print('customer subscription updated start  ------------------------------------------------------')
                self.handle_subscription_updated(data_object)
                print('customer subscription updated end ------------------------------------------------------')
            elif event_type == 'customer.subscription.deleted':
                print('customer subscription deleted start  ------------------------------------------------------')
                self.handle_subscription_deleted(data_object)
                print('customer subscription deleted end ------------------------------------------------------')   
            else:
                print("Unhandled event type ------------------------------------------------------")
                print(f'Unhandled event type {event_type}')

            return {'status': 'success'}

        except Exception as e:
            print(f"Error processing webhook: {str(e)}")
            return {'status': 'error', 'message': str(e)}, 400

    def handle_checkout_session_completed(self, session):

        customer_id = session['customer']
        subscription_id = session['subscription']
        tenant = Tenant.query.filter_by(stripe_customer_id=customer_id).first()

        print(f"------------------ tenant : {tenant}")
        
        if not tenant:
            print(f"No tenant found for customer {customer_id}")
            return

        subscription = stripe.Subscription.retrieve(subscription_id)
        print(f"------------------ subscription : {subscription}")
        stripe_product_id = subscription['items']['data'][0]['plan']['product']
        checkout_plan = BasePlan.query.filter(BasePlan.stripe_product_id==stripe_product_id).first()
        
        if not checkout_plan:
            print(f"No base plan found for stripe  product {stripe_product_id}")
            return

        # Check for existing active plan
        active_plan = TenantPlan.query.filter_by(tenant_id=tenant.id, is_active=True).first()
        print(f"------------------ active_plan : {active_plan}")
        new_plan = None
        
        if active_plan:
            if active_plan.base_plan_id == checkout_plan.id:
                # Extend the current plan
                active_plan.end_date = datetime.fromtimestamp(subscription['current_period_end'])
            else:
                # Deactivate the current plan and create a new one
                active_plan.is_active = False
                new_plan = TenantPlan(
                    tenant_id=tenant.id,
                    base_plan_id=  checkout_plan.id,
                    start_date=datetime.fromtimestamp(subscription['current_period_start']),
                    end_date=datetime.fromtimestamp(subscription['current_period_end']),
                    interval='yearly' if subscription['plan']['interval'] == 'year' else 'monthly',
                    is_active=True,
                    has_paid=True,
                    amount=session['amount_total'] / 100,  # Convert cents to dollars
                )
                db.session.add(new_plan)
                print(f"------------------ new_plan : {new_plan}")
        else:
            # Create a new plan
            new_plan = TenantPlan(
                tenant_id=tenant.id,
                base_plan_id=  checkout_plan.id,
                start_date=datetime.fromtimestamp(subscription['current_period_start']),
                end_date=datetime.fromtimestamp(subscription['current_period_end']),
                interval='yearly' if subscription['plan']['interval'] == 'year' else 'monthly',
                is_active=True,
                has_paid=True,
                amount=session['amount_total'] / 100  # Convert cents to dollars
            )
            db.session.add(new_plan)
            print(f"------------------ new_plan : {new_plan}")


        db.session.flush()

        # Create a transaction record
        transaction = Transaction(
            tenant_id=tenant.id,
            tenant_plan_id=new_plan.id if new_plan else active_plan.id,
            amount=session['amount_total'] / 100,
            currency=session['currency'],
            status='completed',
            stripe_payment_intent_id=session['payment_intent'],
            stripe_customer_id=customer_id,
            stripe_subscription_id=subscription_id,
            payment_method_type=session['payment_method_types'][0],
            description=f"Subscription payment for {checkout_plan.plan_type} plan"
        )
        print(f"------------------ transaction : {transaction}")
        db.session.add(transaction)

        db.session.commit()

    def handle_invoice_paid(self, invoice):
        customer_id = invoice['customer']
        subscription_id = invoice['subscription']
        tenant = Tenant.query.filter_by(stripe_customer_id=customer_id).first()
        
        if not tenant:
            print(f"No tenant found for customer {customer_id}")
            return

        tenant_plan = TenantPlan.query.filter_by(tenant_id=tenant.id, is_active=True).first()
        
        if tenant_plan:
            tenant_plan.has_paid = True
            tenant_plan.end_date = datetime.fromtimestamp(invoice['lines']['data'][0]['period']['end'])

            transaction = Transaction(
                tenant_id=tenant.id,
                tenant_plan_id=tenant_plan.id,
                amount=invoice['amount_paid'] / 100,
                currency=invoice['currency'],
                status='completed',
                stripe_invoice_id=invoice['id'],
                stripe_customer_id=customer_id,
                stripe_subscription_id=subscription_id,
                payment_method_type=invoice['payment_method_details']['type'],
                description=f"Invoice payment for {tenant_plan.base_plan.plan_type} plan"
            )
            db.session.add(transaction)

            db.session.commit()

    def handle_invoice_payment_failed(self, invoice):
        customer_id = invoice['customer']
        subscription_id = invoice['subscription']
        tenant = Tenant.query.filter_by(stripe_customer_id=customer_id).first()
        
        if not tenant:
            print(f"No tenant found for customer {customer_id}")
            return

        tenant_plan = TenantPlan.query.filter_by(tenant_id=tenant.id, is_active=True).first()
        
        if tenant_plan:
            transaction = Transaction(
                tenant_id=tenant.id,
                tenant_plan_id=tenant_plan.id,
                amount=invoice['amount_due'] / 100,
                currency=invoice['currency'],
                status='failed',
                stripe_invoice_id=invoice['id'],
                stripe_customer_id=customer_id,
                stripe_subscription_id=subscription_id,
                description=f"Failed invoice payment for {tenant_plan.base_plan.plan_type} plan"
            )
            db.session.add(transaction)

            db.session.commit()

    def handle_subscription_updated(self, subscription):
        customer_id = subscription['customer']
        tenant = Tenant.query.filter_by(stripe_customer_id=customer_id).first()
        
        if not tenant:
            print(f"No tenant found for customer {customer_id}")
            return

        tenant_plan = TenantPlan.query.filter_by(tenant_id=tenant.id, is_active=True).first()
        
        if tenant_plan:
            tenant_plan.end_date = datetime.fromtimestamp(subscription['current_period_end'])
            tenant_plan.interval = 'yearly' if subscription['plan']['interval'] == 'year' else 'monthly'
            
            db.session.commit()

    def handle_subscription_deleted(self, subscription):
        customer_id = subscription['customer']
        tenant = Tenant.query.filter_by(stripe_customer_id=customer_id).first()
        
        if not tenant:
            print(f"No tenant found for customer {customer_id}")
            return

        tenant_plan = TenantPlan.query.filter_by(tenant_id=tenant.id, is_active=True).first()
        
        if tenant_plan:
            tenant_plan.is_active = False
            tenant_plan.end_date = datetime.utcnow()
            
            db.session.commit()

api.add_resource(StripeWebhookApi, '/stripe')

