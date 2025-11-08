from locust import HttpUser, task

class DifyUser(HttpUser):
    @task
    def hello_world(self):
        self.client.get("/")
