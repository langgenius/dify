# Dify with ClickZetta Lakehouse Integration

This is a pre-release version of Dify with ClickZetta Lakehouse vector database integration, available while the official PR is under review.

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose installed
- ClickZetta Lakehouse account and credentials
- At least 4GB RAM available for Docker

### 1. Download Configuration Files
```bash
# Download the docker-compose file
curl -O https://raw.githubusercontent.com/yunqiqiliang/dify/feature/clickzetta-vector-db/clickzetta/docker-compose.clickzetta.yml

# Download environment template
curl -O https://raw.githubusercontent.com/yunqiqiliang/dify/feature/clickzetta-vector-db/clickzetta/.env.clickzetta.example
```

### 2. Configure Environment
```bash
# Copy environment template
cp .env.clickzetta.example .env

# Edit with your ClickZetta credentials
nano .env
```

**Required ClickZetta Settings:**
```bash
CLICKZETTA_USERNAME=your_username
CLICKZETTA_PASSWORD=your_password
CLICKZETTA_INSTANCE=your_instance
```

### 3. Launch Dify
```bash
# Create required directories
mkdir -p volumes/app/storage volumes/db/data volumes/redis/data

# Start all services
docker-compose -f docker-compose.clickzetta.yml up -d

# Check status
docker-compose -f docker-compose.clickzetta.yml ps
```

### 4. Access Dify
- Open http://localhost in your browser
- Complete the setup wizard
- In dataset settings, select "ClickZetta" as vector database

## 🎯 ClickZetta Features

### Supported Operations
- ✅ **Vector Search** - Semantic similarity search using HNSW index
- ✅ **Full-text Search** - Text search with Chinese/English analyzers
- ✅ **Hybrid Search** - Combined vector + full-text search
- ✅ **Metadata Filtering** - Filter by document attributes
- ✅ **Batch Processing** - Efficient bulk document ingestion

### Performance Features  
- **Auto-scaling** - Lakehouse architecture scales with your data
- **Inverted Index** - Fast full-text search with configurable analyzers
- **Parameterized Queries** - Secure and optimized SQL execution
- **Batch Optimization** - Configurable batch sizes for optimal performance

### Configuration Options
```bash
# Performance tuning
CLICKZETTA_BATCH_SIZE=20                    # Documents per batch
CLICKZETTA_VECTOR_DISTANCE_FUNCTION=cosine_distance  # or l2_distance

# Full-text search
CLICKZETTA_ENABLE_INVERTED_INDEX=true       # Enable text search
CLICKZETTA_ANALYZER_TYPE=chinese            # chinese, english, unicode, keyword  
CLICKZETTA_ANALYZER_MODE=smart              # smart, max_word

# Database settings
CLICKZETTA_SCHEMA=dify                      # Database schema name
CLICKZETTA_WORKSPACE=quick_start            # ClickZetta workspace
CLICKZETTA_VCLUSTER=default_ap              # Virtual cluster name
```

## 🔧 Troubleshooting

### Common Issues

**Connection Failed:**
```bash
# Check ClickZetta credentials
docker-compose -f docker-compose.clickzetta.yml logs api | grep clickzetta

# Verify network connectivity
docker-compose -f docker-compose.clickzetta.yml exec api ping api.clickzetta.com
```

**Performance Issues:**
```bash
# Adjust batch size for your instance
CLICKZETTA_BATCH_SIZE=10  # Reduce for smaller instances
CLICKZETTA_BATCH_SIZE=50  # Increase for larger instances
```

**Search Not Working:**
```bash
# Check index creation
docker-compose -f docker-compose.clickzetta.yml logs api | grep "Created.*index"

# Verify table structure
docker-compose -f docker-compose.clickzetta.yml logs api | grep "Created table"
```

### Get Logs
```bash
# All services
docker-compose -f docker-compose.clickzetta.yml logs

# Specific service
docker-compose -f docker-compose.clickzetta.yml logs api
docker-compose -f docker-compose.clickzetta.yml logs worker
```

### Clean Installation
```bash
# Stop and remove containers
docker-compose -f docker-compose.clickzetta.yml down -v

# Remove data (WARNING: This deletes all data)
sudo rm -rf volumes/

# Start fresh
mkdir -p volumes/app/storage volumes/db/data volumes/redis/data
docker-compose -f docker-compose.clickzetta.yml up -d
```

## 📚 Documentation

- [ClickZetta Lakehouse](https://docs.clickzetta.com/) - Official ClickZetta documentation
- [Dify Documentation](https://docs.dify.ai/) - Official Dify documentation  
- [Integration Guide](./INSTALLATION_GUIDE.md) - Detailed setup instructions

## 🐛 Issues & Support

This is a preview version. If you encounter issues:

1. Check the troubleshooting section above
2. Review logs for error messages
3. Open an issue on the [GitHub repository](https://github.com/yunqiqiliang/dify/issues)

## 🔄 Updates

To update to the latest version:
```bash
# Pull latest images
docker-compose -f docker-compose.clickzetta.yml pull

# Restart services  
docker-compose -f docker-compose.clickzetta.yml up -d
```

## ⚠️ Production Use

This is a preview build for testing purposes. For production deployment:
- Wait for the official PR to be merged
- Use official Dify releases
- Follow Dify's production deployment guidelines

---

**Built with ❤️ for the Dify community**