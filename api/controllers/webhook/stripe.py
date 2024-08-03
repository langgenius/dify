import os 
import json
from flask import request, jsonify
from flask_restful import Resource
from controllers.webhook import api
import stripe

class StripeWebhookApi(Resource):
    
    def post(self):
        webhook_secret = '{{STRIPE_WEBHOOK_SECRET}}'
        request_data = json.loads(request.data)

        if webhook_secret:
            # Retrieve the event by verifying the signature using the raw body and secret if webhook signing is configured.
            signature = request.headers.get('stripe-signature')
            try:
                event = stripe.Webhook.construct_event(
                    payload=request.data, sig_header=signature, secret=webhook_secret)
                data = event['data']
            except Exception as e:
                return str(e)
            # Get the type of webhook event sent - used to check the status of PaymentIntents.
            event_type = event['type']
        else:
            data = request_data['data']
            event_type = request_data['type']
        data_object = data['object']
        print('data_object')
        print(data_object)
        if event_type == 'checkout.session.completed':
            # Payment is successful and the subscription is created.
            # You should provision the subscription and save the customer ID to your database.

            # create entry in the transcation table 
            # create tenant customer table entry  and if the no active plan for customer , mae this plan active 
            # create entry in the tenatn customer id table 


            # create a task and put to theh queue that will expire this plan 
             


            print(data)
        elif event_type == 'invoice.paid':
            # Continue to provision the subscription as payments continue to be made.
            # Store the status in your database and check when a user accesses your service.
            # This approach helps you avoid hitting rate limits.
            
            # increate the enddate of the plan 

            # if the queyr have a expier plan  , remove it corresponding to this plan , tenant id 

            # create a task and put to theh queue that will expire this plan
             
            
            print(data)
        elif event_type == 'invoice.payment_failed':
            # The payment failed or the customer does not have a valid payment method.
            # The subscription becomes past_due. Notify your customer and send them to the
            # customer portal to update their payment information.
            print(data)
        else:
            print('Unhandled event type {}'.format(event_type))
            print(data)
        return jsonify({'status': 'success'})




api.add_resource(StripeWebhookApi, '/stripe')