from datetime import datetime
import os
from urllib import response 
from extensions.ext_database import db
import random
import string
from models.account import EmailVerificationCode
import resend 



resend.api_key = os.getenv('RESEND_API_KEY')
FROM_EMAIL = os.getenv('RESEND_EMAIL_FROM')

class EmailService:


    
    @staticmethod
    def send_login_email(email : str , magic_link_url : str , verification_code : str):

        try: 

            html_content = EmailService.get_email_template(magic_link_url, verification_code)
            
            params: resend.Emails.SendParams = {
                "from": FROM_EMAIL,
                "to":  email,
                "subject": "Verify your email",
                "html": html_content,
            }

            email = resend.Emails.send(params)

            print(email)

            return { "success" : True , "message" : "Successfully sent email"}
            
        
        except Exception as e:
            print(e)
            return { "success" : False , "message" : "Failed to send email"}



            

    @staticmethod
    def create_verification_code(email : str):

        try :
            # create random code
            randome_code = EmailService.generate_random_string()
            new_code = EmailVerificationCode(email=email, code=randome_code)
            db.session.add(new_code)
            db.session.commit()
            return {
                "success" : True , 
                "message" : "Successfully created email verification code",
                "code" : randome_code
            }


        except Exception as e:
            print(e)
            return { "success" : False , "message" : "Failed to create email verification code"}

            
     

    @staticmethod
    def generate_random_string(length=10):
       characters = string.ascii_letters + string.digits
       return ''.join(random.choice(characters) for _ in range(length))

       
       

    @staticmethod
    def verify_code(code: str):
        try:
            verification = EmailVerificationCode.query.filter_by(
                code=code
            ).filter(
                EmailVerificationCode.expired_at > datetime.utcnow()
            ).first()

            if verification:
                verification.expire_now()
                db.session.commit()
                return {
                    "success": True,
                    "message": "Successfully verified email verification code",
                    "email": verification.email
                }
            else:
                return {
                    "success": False,
                    "message": "Invalid or expired verification code"
                }
        except Exception as e:
            print(f"Error verifying code: {e}")
            return {"success": False, "message": "Failed to verify email verification code"}


    @staticmethod
    def get_email_template(magic_link_url: str, verification_code: str) -> str:
        return f"""
        <html dir="ltr" lang="en">
        <head>
        <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
        <meta name="x-apple-disable-message-reformatting" />
        </head>
        <body style="background-color:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,Oxygen-Sans,Ubuntu,Cantarell,&quot;Helvetica Neue&quot;,sans-serif">
        <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:600px;margin:0 auto;padding:20px 0 48px;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
        <tbody>
        <tr style="width:100%">
        <td style="padding:32px;">
        <img src="https://app.chaindesk.ai/_next/image?url=%2Flogo.png&w=2048&q=75" alt="ChatBotX Logo" style="display:block;margin:0 auto 24px;width:120px;height:auto;" />
        <h1 style="font-size:28px;letter-spacing:-0.5px;line-height:1.3;font-weight:600;color:#333;text-align:center;margin-bottom:24px;">Welcome to ChatBotX</h1>
        <p style="font-size:16px;line-height:1.5;margin:0 0 24px;color:#555;text-align:center;">Thank you for choosing ChatBotX. To complete your login, please use the button below or enter the verification code.</p>
        <table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="padding:0 0 24px">
        <tbody>
        <tr>
        <td align="center"><a href="{magic_link_url}" style="line-height:100%;text-decoration:none;display:inline-block;max-width:100%;background-color:#4CAF50;border-radius:4px;font-weight:600;color:#ffffff;font-size:16px;text-align:center;padding:12px 24px;" target="_blank">Login to ChatBotX</a></td>
        </tr>
        </tbody>
        </table>
        <p style="font-size:16px;line-height:1.5;margin:0 0 16px;color:#555;text-align:center;">This link and code will only be valid for the next  24 hours. If the button doesn't work, you can use this verification code:</p>
        <p style="text-align:center;"><code style="font-family:monospace;font-weight:700;padding:8px 12px;background-color:#f0f0f0;letter-spacing:1px;font-size:24px;border-radius:4px;color:#333;">{verification_code}</code></p>
        <hr style="width:100%;border:none;border-top:1px solid #e0e0e0;margin:32px 0" />
        <p style="font-size:14px;line-height:1.5;margin:0;color:#888;text-align:center;">If you didn't request this login, please ignore this email or contact our support team if you have any concerns.</p>
        <p style="font-size:14px;line-height:1.5;margin:16px 0 0;color:#888;text-align:center;">&copy; 2024 ChatBotX. All rights reserved.</p>
        </td>
        </tr>
        </tbody>
        </table>
        </body>
        </html>
        """