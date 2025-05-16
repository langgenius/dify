from flask import Flask, request
from flask_restful import Api, Resource

app = Flask(__name__)
api = Api(app)

# Mock data
todos_data = {
    "global": ["Buy groceries", "Finish project"],
    "user1": ["Go for a run", "Read a book"],
}


class TodosResource(Resource):
    def get(self, username):
        todos = todos_data.get(username, [])
        return {"todos": todos}

    def post(self, username):
        data = request.get_json()
        new_todo = data.get("todo")
        todos_data.setdefault(username, []).append(new_todo)
        return {"message": "Todo added successfully"}

    def delete(self, username):
        data = request.get_json()
        todo_idx = data.get("todo_idx")
        todos = todos_data.get(username, [])

        if 0 <= todo_idx < len(todos):
            del todos[todo_idx]
            return {"message": "Todo deleted successfully"}

        return {"error": "Invalid todo index"}, 400


api.add_resource(TodosResource, "/todos/<string:username>")

if __name__ == "__main__":
    app.run(port=5003, debug=True)
