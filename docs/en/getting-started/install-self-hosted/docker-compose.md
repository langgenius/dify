# Docker Compose Deployment

## Prerequisites

| Operating System           | Software                                                       | Explanation                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS 10.14 or later       | Docker Desktop                                                 | Set the Docker virtual machine (VM) to use a minimum of 2 virtual CPUs (vCPUs) and 8 GB of initial memory. Otherwise, the installation may fail. For more information, please refer to the [Docker Desktop installation guide for Mac](https://docs.docker.com/desktop/mac/install/).                                                     |
| Linux platforms            | <p>Docker 19.03 or later<br>Docker Compose 1.25.1 or later</p> | Please refer to the [Docker installation guide](https://docs.docker.com/engine/install/) and [the Docker Compose installation guide](https://docs.docker.com/compose/install/) for more information on how to install Docker and Docker Compose, respectively.                                                                            |
| Windows with WSL 2 enabled | Docker Desktop                                                 | We recommend storing the source code and other data that is bound to Linux containers in the Linux file system rather than the Windows file system. For more information, please refer to the [Docker Desktop installation guide for using the WSL 2 backend on Windows.](https://docs.docker.com/desktop/windows/install/#wsl-2-backend) |

### Clone Dify

Clone the Dify source code to your local machine:

```Shell
git clone https://github.com/langgenius/dify.git
```

### Start Dify

Navigate to the docker directory in the Dify source code and execute the following command to start Dify:

```Shell
cd dify/docker
docker compose up -d
```

> If your system has Docker Compose V2 installed instead of V1, use `docker compose` instead of `docker-compose`. Check if this is the case by running `$ docker compose version`. [Read more information here](https://docs.docker.com/compose/#compose-v2-and-the-new-docker-compose-command).

Deployment Results:

```Shell
[+] Running 7/7
 ✔ Container docker-web-1       Started                                                                                                                                                                                       1.0s 
 ✔ Container docker-redis-1     Started                                                                                                                                                                                       1.1s 
 ✔ Container docker-weaviate-1  Started                                                                                                                                                                                       0.9s 
 ✔ Container docker-db-1        Started                                                                                                                                                                                       0.0s 
 ✔ Container docker-worker-1    Started                                                                                                                                                                                       0.7s 
 ✔ Container docker-api-1       Started                                                                                                                                                                                       0.8s 
 ✔ Container docker-nginx-1     Started
```

Finally, check if all containers are running successfully:

```Shell
docker compose ps
```

This includes 3 business services: api / worker / web, and 4 underlying components: weaviate / db / redis / nginx.

```Shell
NAME                IMAGE                              COMMAND                  SERVICE             CREATED             STATUS              PORTS
docker-api-1        langgenius/dify-api:0.3.2          "/entrypoint.sh"         api                 4 seconds ago       Up 2 seconds        80/tcp, 5001/tcp
docker-db-1         postgres:15-alpine                 "docker-entrypoint.s…"   db                  4 seconds ago       Up 2 seconds        0.0.0.0:5432->5432/tcp
docker-nginx-1      nginx:latest                       "/docker-entrypoint.…"   nginx               4 seconds ago       Up 2 seconds        0.0.0.0:80->80/tcp
docker-redis-1      redis:6-alpine                     "docker-entrypoint.s…"   redis               4 seconds ago       Up 3 seconds        6379/tcp
docker-weaviate-1   semitechnologies/weaviate:1.18.4   "/bin/weaviate --hos…"   weaviate            4 seconds ago       Up 3 seconds        
docker-web-1        langgenius/dify-web:0.3.2          "/entrypoint.sh"         web                 4 seconds ago       Up 3 seconds        80/tcp, 3000/tcp
docker-worker-1     langgenius/dify-api:0.3.2          "/entrypoint.sh"         worker              4 seconds ago       Up 2 seconds        80/tcp, 5001/tcp
```
