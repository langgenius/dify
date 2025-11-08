# Dify Audit Report

This report details the findings of a security and performance audit conducted on the Dify application.

## 1. Dependency Analysis

### 1.1 Backend Dependencies

The backend dependency scan, performed with `safety`, revealed the following vulnerabilities:

* **langfuse (version 2.51.5):**
    * **ID:** 73564, **Affected spec:** <2.81.1, **Advisory:** Open Redirect (CWE-601)
    * **ID:** 75618, **Affected spec:** <2.95.3, **Advisory:** Security upgrade of jsonpath-plus dependency
    * **ID:** 75619, **Affected spec:** <3.28.1, **Advisory:** Security upgrades for DOMPurify and release-it dependencies
    * **ID:** 75620, **Affected spec:** <2.95.2, **Advisory:** DOMPurify library upgrade to address potential XSS vulnerabilities
    * **ID:** 77285, **Affected spec:** <3.54.1, **Advisory:** Hyperlink injection in organization invitation emails
* **pycryptodome (version 3.19.1):**
    * **ID:** 63680, **Affected spec:** <3.20.0, **Advisory:** Side-channel leakage in OAEP decryption
* **py (version 1.11.0):**
    * **ID:** 51457, **Affected spec:** <=1.11.0, **Advisory:** ReDoS (Regular expression Denial of Service)
* **litellm (version 1.77.1):**
    * **ID:** 80130, **Affected spec:** <1.77.7.rc.1, **Advisory:** Information Disclosure due to JWT SSO insertion
    * **ID:** 80100, **Affected spec:** <1.77.7.rc.1, **Advisory:** Information Disclosure due to incomplete sanitization

### 1.2 Frontend Dependencies

The frontend dependency scan, performed with `pnpm audit`, revealed the following vulnerability:

* **dompurify:**
    * **Severity:** moderate
    * **Vulnerable versions:** <3.2.4
    * **Patched versions:** >=3.2.4
    * **Advisory:** Cross-site Scripting (XSS)

## 2. Static Code Analysis

### 2.1 Backend

The backend static code analysis, performed with `ruff`, revealed one remaining issue after auto-fixing:

* `print` statement found in `controllers/webhook_controller.py`. It is recommended to use a proper logger instead of `print`.

### 2.2 Frontend

The frontend static code analysis, performed with `eslint`, revealed 466 problems (10 errors, 456 warnings). A full list of these issues is available in the `eslint` output.

## 3. Stress Testing and Performance Analysis (To Be Completed)

This section will be completed once the application is running.
