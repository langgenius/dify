#!/usr/bin/env python3
"""
Manual test script for email registration API.
Run this script to test the new registration flow with the server running on port 5001.
"""

import time
from typing import Any

import requests


class RegistrationTester:
    """Test class for registration API."""
    
    def __init__(self, base_url: str = "http://localhost:5001"):
        self.base_url = base_url
        self.session = requests.Session()
        
    def test_send_verification_code(self, email: str) -> dict[str, Any]:
        """Test sending verification code."""
        print(f"🔵 Testing verification code send for: {email}")
        
        response = self.session.post(
            f"{self.base_url}/service/auth/email-code-login",
            json={"email": email},
            headers={"Content-Type": "application/json"}
        )
        
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.text}")
        
        return {
            "status_code": response.status_code,
            "response": (
                response.json() 
                if response.headers.get('content-type', '').startswith('application/json') 
                else response.text
            )
        }
    
    def test_registration_with_code(self, email: str, code: str, token: str) -> dict[str, Any]:
        """Test registration with verification code."""
        print(f"🔵 Testing registration for: {email} with code: {code}")
        
        response = self.session.post(
            f"{self.base_url}/service/auth/email-code-login/validity",
            json={"email": email, "code": code, "token": token},
            headers={"Content-Type": "application/json"}
        )
        
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.text}")
        
        return {
            "status_code": response.status_code,
            "response": (
                response.json() 
                if response.headers.get('content-type', '').startswith('application/json') 
                else response.text
            )
        }
    
    def test_verification_code_sending(self, email: str) -> dict[str, Any]:
        """Test verification code sending (first step only)."""
        print(f"\n🚀 Testing verification code sending for: {email}")
        print("=" * 50)
        
        # Step 1: Send verification code
        send_result = self.test_send_verification_code(email)
        
        if send_result["status_code"] != 200:
            print(f"❌ Failed to send verification code for {email}")
            return send_result
        
        print(f"✅ Verification code sent successfully for {email}")
        
        # Extract token from send result
        token = None
        if isinstance(send_result["response"], dict) and "data" in send_result["response"]:
            token = send_result["response"]["data"]
            print(f"ℹ️  Received token: {token}")
            print(f"ℹ️  A verification code has been sent to {email}")
            print("ℹ️  To complete registration, user would enter the code from their email")
        else:
            print("❌ No token received from verification code send")
            return {"status_code": 400, "response": "No token received"}
        
        return {"status_code": 200, "response": "Verification code sent successfully", "token": token}
    
    def test_registration_flow_interactive(self, email: str) -> dict[str, Any]:
        """Test full registration flow with user input for verification code."""
        print(f"\n🚀 Testing INTERACTIVE registration flow for: {email}")
        print("=" * 50)
        
        # Step 1: Send verification code
        send_result = self.test_send_verification_code(email)
        
        if send_result["status_code"] != 200:
            print(f"❌ Failed to send verification code for {email}")
            return send_result
        
        print(f"✅ Verification code sent successfully for {email}")
        
        # Extract token from send result
        token = None
        if isinstance(send_result["response"], dict) and "data" in send_result["response"]:
            token = send_result["response"]["data"]
            print(f"ℹ️  Received token: {token}")
        else:
            print("❌ No token received from verification code send")
            return {"status_code": 400, "response": "No token received"}
        
        # Step 2: Get verification code from user
        print(f"📧 A verification code has been sent to {email}")
        verification_code = input("🔢 Please enter the verification code from your email: ").strip()
        
        if not verification_code:
            print("❌ No verification code entered")
            return {"status_code": 400, "response": "No verification code entered"}
        
        register_result = self.test_registration_with_code(email, verification_code, token)
        
        if register_result["status_code"] == 200:
            print(f"✅ Registration successful for {email}")
        else:
            print(f"❌ Registration failed for {email}")
        
        return register_result
    
    def run_comprehensive_tests(self):
        """Run comprehensive tests for different email scenarios."""
        print("🧪 Running Comprehensive Email Verification Code Tests")
        print("=" * 60)
        print("ℹ️  This tests verification code sending (step 1 of registration)")
        print("ℹ️  For full registration testing, use interactive mode")
        
        test_cases = [
            {
                "email": "student@university.edu",
                "description": "University student (.edu domain)",
                "expected_org": "Should be assigned to organization if domain match exists"
            },
            {
                "email": "user@gmail.com",
                "description": "Personal Gmail account",
                "expected_org": "Should register without organization assignment"
            },
            {
                "email": "employee@company.com",
                "description": "Company email without pre-configured organization",
                "expected_org": "Should register without organization assignment"
            },
            {
                "email": "admin@startup.io",
                "description": "Startup email",
                "expected_org": "Should register without organization assignment"
            },
            {
                "email": "test@protonmail.com",
                "description": "ProtonMail account",
                "expected_org": "Should register without organization assignment"
            }
        ]
        
        results = []
        
        for i, test_case in enumerate(test_cases, 1):
            print(f"\n📋 Test Case {i}: {test_case['description']}")
            print(f"   Email: {test_case['email']}")
            print(f"   Expected: {test_case['expected_org']}")
            
            result = self.test_verification_code_sending(test_case["email"])
            results.append({
                "test_case": test_case,
                "result": result
            })
            
            # Small delay between tests
            time.sleep(0.5)
        
        # Summary
        print("\n📊 Test Results Summary")
        print("=" * 30)
        
        for i, test_result in enumerate(results, 1):
            test_case = test_result["test_case"]
            result = test_result["result"]
            
            status = "✅ PASSED" if result["status_code"] == 200 else "❌ FAILED"
            print(f"{i}. {test_case['description']}: {status}")
            
            if result["status_code"] != 200:
                print(f"   Error: {result['response']}")
        
        # Overall summary
        passed = sum(1 for r in results if r["result"]["status_code"] == 200)
        total = len(results)
        print(f"\n🎯 Overall: {passed}/{total} verification code tests passed")
        
        return results


def main():
    """Main function to run tests."""
    print("🔍 Email Registration API Test Suite")
    print("=" * 40)
    
    tester = RegistrationTester()
    
    # Check if server is running
    try:
        response = requests.get("http://localhost:5001/health", timeout=5)
        print("✅ Server is running on port 5001")
    except requests.exceptions.RequestException:
        print("❌ Server is not running on port 5001")
        print("   Please start the server with: uv run flask run --host 0.0.0.0 --port=5001 --debug")
        return
    
    # Run comprehensive tests
    results = tester.run_comprehensive_tests()
    
    # Additional specific tests
    print("\n🔬 Additional Tests")
    print("=" * 20)
    
    # Test invalid email
    print("\n🔵 Testing invalid email format")
    invalid_result = tester.test_send_verification_code("invalid.email")
    if invalid_result["status_code"] != 200:
        print("✅ Invalid email correctly rejected")
    else:
        print("❌ Invalid email was accepted (should be rejected)")
    
    # Test registration with invalid code
    print("\n🔵 Testing registration with invalid code")
    # First get a valid token
    send_result = tester.test_send_verification_code("test@example.com")
    if send_result["status_code"] == 200 and isinstance(send_result["response"], dict):
        token = send_result["response"]["data"]
        invalid_code_result = tester.test_registration_with_code("test@example.com", "wrong_code", token)
        if invalid_code_result["status_code"] != 200:
            print("✅ Invalid verification code correctly rejected")
        else:
            print("❌ Invalid verification code was accepted (should be rejected)")
    else:
        print("⚠️  Could not test invalid code - failed to get token")
    
    print("\n🎉 All tests completed!")
    print("\nℹ️  Note: This test uses mock verification codes.")
    print("   In production, users would receive actual codes via email.")


if __name__ == "__main__":
    main()