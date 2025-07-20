# ☁️ Google Cloud Deployment Guide

Complete guide to deploy Dify on Google Cloud Platform with $300 free credits (12 months).

## 🎯 Quick Setup (10 minutes)

### 1. Create Google Cloud Account
1. Go to [cloud.google.com](https://cloud.google.com)
2. **Sign up** → Get **$300 free credits** (12 months)
3. **Create new project** → Note your PROJECT_ID

### 2. Enable Required APIs & Install Tools

```bash
# Install Google Cloud SDK
curl https://sdk.cloud.google.com | bash
exec -l $SHELL

# Login to Google Cloud
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Install Terraform (optional but recommended)
curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo apt-key add -
sudo apt-add-repository "deb [arch=amd64] https://apt.releases.hashicorp.com $(lsb_release -cs) main"
sudo apt-get update && sudo apt-get install terraform
```

## 🚀 Option A: One-Click Infrastructure Setup (Recommended)

### Using Terraform (Automated):

```bash
# Clone your repo and navigate to terraform directory
cd terraform

# Initialize Terraform
terraform init

# Plan deployment
terraform plan -var="project_id=YOUR_PROJECT_ID"

# Deploy infrastructure
terraform apply -var="project_id=YOUR_PROJECT_ID" -auto-approve
```

**This automatically creates:**
✅ Cloud SQL PostgreSQL database  
✅ Redis Memory Store  
✅ Secret Manager secrets  
✅ Artifact Registry  
✅ Cloud Build trigger  
✅ All required APIs enabled  

## 🔧 Option B: Manual Setup

### 2.1 Enable APIs
```bash
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com
```

### 2.2 Create Database
```bash
# Create PostgreSQL instance
gcloud sql instances create dify-postgres \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --storage-size=10GB \
  --storage-type=SSD

# Create database
gcloud sql databases create dify --instance=dify-postgres

# Create user
gcloud sql users create dify --instance=dify-postgres --password=YOUR_DB_PASSWORD
```

### 2.3 Create Redis
```bash
gcloud redis instances create dify-redis \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_7_0
```

### 2.4 Store Secrets
```bash
# Create secrets
gcloud secrets create database-url
gcloud secrets create redis-url  
gcloud secrets create secret-key
gcloud secrets create openai-api-key

# Add secret values
echo "postgresql://dify:YOUR_DB_PASSWORD@/dify?host=/cloudsql/YOUR_PROJECT:us-central1:dify-postgres" | gcloud secrets versions add database-url --data-file=-

echo "redis://REDIS_IP:6379/0" | gcloud secrets versions add redis-url --data-file=-

echo "YOUR_SECRET_KEY" | gcloud secrets versions add secret-key --data-file=-

echo "YOUR_OPENAI_API_KEY" | gcloud secrets versions add openai-api-key --data-file=-
```

## 🔐 GitHub Setup

### 1. Create Service Account
```bash
# Create service account
gcloud iam service-accounts create github-actions \
  --description="GitHub Actions deployment" \
  --display-name="GitHub Actions"

# Grant permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.builder"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.admin"

# Create and download key
gcloud iam service-accounts keys create github-sa-key.json \
  --iam-account=github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### 2. Add GitHub Secrets
Go to your GitHub repo → Settings → Secrets and variables → Actions:

- `GCP_PROJECT_ID`: Your Google Cloud Project ID
- `GCP_SA_KEY`: Contents of `github-sa-key.json` file

## 🚀 Deploy

### Auto-deployment:
Push to `main` branch → Auto-deploys via GitHub Actions

### Manual deployment:
```bash
# Trigger deployment
gcloud builds submit --config cloudbuild.yaml
```

## 📊 Cost Breakdown (Free Credits)

**With $300 free credits:**
- **Cloud Run**: ~$15-25/month (API + Web + Worker)
- **Cloud SQL**: ~$10-15/month (db-f1-micro)  
- **Redis**: ~$5-10/month (1GB Memory Store)
- **Storage**: ~$2-5/month (Container Registry, logs)

**Total: ~$30-55/month** (Covered by $300 credits for 6-10 months)

## 🔄 Auto-Updates

Your setup includes:
1. **Daily sync** with upstream Dify (creates PRs)
2. **Auto-deployment** when PRs merge to main
3. **Zero-downtime** rolling updates

## 🌐 Access Your App

After deployment:
- **Web App**: `https://dify-web-[hash]-uc.a.run.app`
- **API**: `https://dify-api-[hash]-uc.a.run.app`

Get URLs:
```bash
gcloud run services list --platform managed
```

## 📈 Scaling & Monitoring

### Scale services:
```bash
# Scale API service
gcloud run services update dify-api \
  --max-instances=20 \
  --memory=4Gi \
  --cpu=4
```

### Monitor:
- **Google Cloud Console** → Cloud Run → Metrics
- **Logs**: Cloud Console → Logging
- **Alerts**: Cloud Monitoring

## 🎯 Next Steps

1. **Custom domain**: Cloud Run → Manage Custom Domains
2. **CDN**: Cloud CDN for better performance
3. **Multi-region**: Deploy to multiple regions
4. **Backup**: Automated database backups (already configured)

## 🆘 Troubleshooting

```bash
# Check deployment status
gcloud run services list

# View logs
gcloud logging read "resource.type=cloud_run_revision"

# Test database connection
gcloud sql connect dify-postgres --user=dify
```

## 🎉 Success!

Your Dify instance is now running on professional Google Cloud infrastructure with:
- **Auto-scaling** based on traffic
- **Managed databases** with backups
- **Auto-deployment** from GitHub
- **SSL certificates** (automatic)
- **Global CDN** (Cloud Run handles this)

🚀 **Enterprise-grade deployment complete!**
