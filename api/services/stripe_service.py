from extensions.ext_database import db
from models.account import BasePlan
import stripe
from stripe.error import StripeError
from typing import List, Dict, Union, Optional
import os


class StripeService:

    stripe.api_key = os.getenv('STRIPE_SECRET_KEY')

    @staticmethod
    def create_customer(email: str, name: str) -> Optional[stripe.Customer]:
        try:
            existing_customers = stripe.Customer.list(email=email, limit=1)
            if existing_customers.data:
                return existing_customers.data[0]
            
            customer = stripe.Customer.create(
                email=email,
                name=name ,
            )

            return customer

        except StripeError as e:
            print(f"Error creating/retrieving customer: {str(e)}")
            return None

    @staticmethod
    def cancel_subscription(subscription_id: str) -> Optional[stripe.Subscription]:
        try:
            canceled_subscription = stripe.Subscription.delete(subscription_id)
            return canceled_subscription
        except StripeError as e:
            print(f"Error canceling subscription: {str(e)}")
            return None

    @staticmethod
    def create_checkout_session(customer_id: str, price_id: str, success_url: str, cancel_url: str, tenant_id: str) -> Optional[stripe.checkout.Session]:
        try:




            checkout_session = stripe.checkout.Session.create(
                customer=customer_id,
                payment_method_types=['card'],
                line_items=[
                    {
                        'price': price_id,
                        'quantity': 1,
                    },
                ],
                mode='subscription',
                success_url=success_url,
                cancel_url=cancel_url,
                metadata={
                    "tenant_id": tenant_id
                }
            )
            return checkout_session
        except StripeError as e:
            print(f"Error creating checkout session: {str(e)}")
            return None

    @staticmethod
    def get_subscription(subscription_id: str) -> Optional[stripe.Subscription]:
        try:
            subscription = stripe.Subscription.retrieve(subscription_id)
            return subscription
        except StripeError as e:
            print(f"Error retrieving subscription: {str(e)}")
            return None

    @staticmethod
    def update_subscription(subscription_id: str, new_price_id: str) -> Optional[stripe.Subscription]:
        try:
            updated_subscription = stripe.Subscription.modify(
                subscription_id,
                items=[{
                    'id': stripe.Subscription.retrieve(subscription_id)['items']['data'][0].id,
                    'price': new_price_id,
                }]
            )
            return updated_subscription
        except StripeError as e:
            print(f"Error updating subscription: {str(e)}")
            return None

    @staticmethod
    def create_invoice(customer_id: str, items: List[Dict[str, Union[str, int]]], auto_advance: bool = True, days_until_due: int = 30) -> Optional[stripe.Invoice]:
        try:
            # Create a draft invoice
            invoice = stripe.Invoice.create(
                customer=customer_id,
                auto_advance=auto_advance,
                collection_method='send_invoice',
                days_until_due=days_until_due
            )

            # Add line items to the invoice
            for item in items:
                stripe.InvoiceItem.create(
                    customer=customer_id,
                    price=item['price'],
                    quantity=item['quantity'],
                    invoice=invoice.id
                )

            # Finalize the invoice if auto_advance is True
            if auto_advance:
                invoice = stripe.Invoice.finalize_invoice(invoice.id)
            
            # Send the invoice
            stripe.Invoice.send_invoice(invoice.id)

            return invoice

        except StripeError as e:
            print(f"Error creating invoice: {str(e)}")
            return None

    @staticmethod
    def retrieve_invoice(invoice_id: str) -> Optional[stripe.Invoice]:
        try:
            return stripe.Invoice.retrieve(invoice_id)
        except StripeError as e:
            print(f"Error retrieving invoice: {str(e)}")
            return None

            
            
    @staticmethod
    def create_plan_with_price( base_plan_type : str, multiplier : int ):


        

        base_plan_type_with_multiplier = f"{base_plan_type}x{multiplier}" if multiplier > 1 else base_plan_type
        print(f"base_plan_type_with_multiplier : {base_plan_type_with_multiplier}")

        base_plan_multiplier = db.session.query(BasePlan).filter_by(plan_type=base_plan_type_with_multiplier).first()
        print(f"base_plan_multiplier : {base_plan_multiplier}")

        if base_plan_multiplier:
            print("base_plan_multiplier exists")
            return base_plan_multiplier

         
        base_plan = db.session.query(BasePlan).filter_by(plan_type=base_plan_type).first()   
        print(f"base_plan : {base_plan}")
        
        
        if not base_plan:
            raise ValueError("Base plan does not exist enum error fuck")

 
        stripe_plan_name = f"{base_plan.name} x {multiplier}"
        new_plan = stripe.Product.create(name=stripe_plan_name)

        print(f"new_plan : {new_plan}")

        if not new_plan:
            raise ValueError("Error creating new plan")



        monthly_price_new_plan = stripe.Price.create(
            # currency="usd" #TODO: update this with usd on get once get hte strip id  
            currency="inr" ,
            unit_amount= int(base_plan.price_monthly * multiplier),
            recurring={
                "interval": "month",
            },
            product=new_plan["id"]
        
        )

        if not monthly_price_new_plan:
            raise ValueError("Error creating monthly price")

    
        mothly_plan_price_id = monthly_price_new_plan["id"]

        
        
        yearly_price_new_plan = stripe.Price.create(
            # currency="usd" #TODO: update this with usd on get once get hte strip id  
            currency="inr" ,
            unit_amount=  int(base_plan.price_yearly * multiplier),
            recurring={
                "interval": "year",
            },
            product=new_plan["id"]
        )

        if not yearly_price_new_plan:
            raise ValueError("Error creating yearly price")

    
        yearly_plan_price_id = yearly_price_new_plan["id"]

        new_base_plan = BasePlan(
            plan_type = base_plan_type_with_multiplier,
            name = stripe_plan_name,
            description = base_plan.description,
            price_monthly = base_plan.price_monthly * multiplier,
            price_yearly = base_plan.price_yearly * multiplier,
            annotation_quota_limit = base_plan.annotation_quota_limit * multiplier,
            custom_tools = base_plan.custom_tools * multiplier,
            price_id_monthly = mothly_plan_price_id, 
            price_id_yearly = yearly_plan_price_id,
            message_requests = base_plan.message_requests * multiplier ,
            message_credits = base_plan.message_credits * multiplier,
            team_members = base_plan.team_members * multiplier,
            build_apps = base_plan.build_apps * multiplier,
            vector_storage = base_plan.vector_storage * multiplier,
            documents_upload_quota = base_plan.documents_upload_quota * multiplier,
            document_processing_priority = base_plan.document_processing_priority,
            support = base_plan.support,
            custom_branding = base_plan.custom_branding,
            logs_history = base_plan.logs_history,
            model_load_balancing_enabled = base_plan.model_load_balancing_enabled,
            dataset_operator_enabled = base_plan.dataset_operator_enabled,
            documents_bulk_upload = base_plan.documents_bulk_upload,
            
        )

        db.session.add(new_base_plan)
        db.session.commit()

        return new_base_plan

         