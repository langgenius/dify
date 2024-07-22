# Dify SSL Configuration Guide

## Preface

A domain name pointing to the server's IP address is required to set up SSL.

Use document replacing:

- /path/to/dify with the path to the Dify directory.
- <domain_name> with the domain name you have configured.

The process below assumes that your server is running on Debian-based Linux distributions.

### Confirmed Working Distributions

| Status | Distribution | Version   | Architecture | Notes                              |
|--------|--------------|-----------|--------------|------------------------------------|
| [x]    | Ubuntu       | 24.04 LTS | x86_64       | Fully tested and confirmed working |
| [ ]    | Ubuntu       | 22.04 LTS | x86_64       | Not tested, but likely to work     |
| [ ]    | Ubuntu       | 20.04 LTS | x86_64       | Not tested, but likely to work     |

**Status Keys:**

- [x] Fully tested and confirmed working
- [-] Partially tested or with minor issues
- [ ] Not tested

> **Note:**  
> This guide has been thoroughly tested on the above distribution.  
> While it may work on other Debian-based systems, your mileage may vary.  
> We welcome feedback and confirmations for other distributions!

If you successfully use this guide on another distribution, please consider contributing to this list!

## 1. Obtain and Install SSL Certificate

### 1-1. Install Certbot and Get Server Certificate

```bash
# Update system packages
sudo apt update

# Install Certbot
sudo apt install certbot

# Obtain SSL certificate (standalone mode)
sudo certbot certonly --standalone -d <domain_name>

# Or, if use DNS challenge
# sudo certbot certonly --manual --preferred-challenges dns -d <domain_name>
```

### 1-2. Copy the Obtained Server Certificate to Nginx Directory

```bash
cd /path/to/dify/docker
sudo cp /etc/letsencrypt/live/<domain_name>/fullchain.pem ./nginx/ssl/dify.crt
sudo cp /etc/letsencrypt/live/<domain_name>/privkey.pem ./nginx/ssl/dify.key
```

## 2. Edit Dify Configuration Files to Use the Certificate

### 2-1. Place the SSL Connection YAML File

```bash
# Navigate to Dify's docker directory
cd /path/to/dify/docker
cp docker-compose.ssl.yaml.example docker-compose.ssl.yaml
```

### 2-2. Place/Edit the .env Configuration File

### 2-2-1. Create the .env Configuration File

```bash
# Copy the environment configuration file template (Skip this step if it already exists)
cd /path/to/dify/docker
cp .env.example .env

# Edit the environment configuration file
vim .env
```

### 2-2-2. Modify the .env Configuration File

Change the NGINX_HTTPS_ENABLED section in the `.env` file:

```
NGINX_HTTPS_ENABLED=true # Change from false
```

## 3. Restart Docker Services and Verify Operation

```bash
# Stop existing Docker services
sudo docker-compose down

# Start Docker services
sudo docker-compose up -d
```

Then, Verify that your web application is accessible via HTTPS.    
url: http://<domain_name>/install  
then you'll be redirected to https://<domain_name>/install

## 4. [Optional] Create and Set Up Certificate Renewal Script

Below process is not required but recommended if you want to automate the renewal process.

### 4-1. Create the Certificate Renewal Script:

```bash
# Create the renewal script
touch /path/to/dify/renew_cert.sh

# Grant execution permissions to the script
chmod +x /path/to/dify/renew_cert.sh

# Edit the script
vim /path/to/dify/renew_cert.sh
```

Content of `renew_cert.sh`:

```bash
#!/bin/bash
sudo certbot renew --quiet
sudo cp /etc/letsencrypt/live/<domain_name>/fullchain.pem /path/to/dify/docker/nginx/ssl/dify.crt
sudo cp /etc/letsencrypt/live/<domain_name>/privkey.pem /path/to/dify/docker/nginx/ssl/dify.key
cd /path/to/dify/docker && docker-compose restart nginx
```

### 4-2. Set Up Cron Job to periodically renew Script:

```bash
# Grant execution permissions to the script
chmod +x /path/to/dify/renew_cert.sh

# Set up cron job
(crontab -l 2>/dev/null; echo "0 12 * * * /path/to/dify/renew_cert.sh") | crontab -
```
