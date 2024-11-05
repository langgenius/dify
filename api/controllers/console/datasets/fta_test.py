import json

import requests
from sqlalchemy import text

from controllers.console import api

from flask_restful import Resource, reqparse
from extensions.ext_database import db

from models.fta import ComponentFailure, ComponentFailureStats


class FATTestApi(Resource):

    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument(
            "log_process_data",
            nullable=False,
            required=True,
            type=str,
            location="args"
        )
        args = parser.parse_args()
        print(args["log_process_data"])
        # Extract the JSON string from the text field
        json_str = args["log_process_data"].strip("```json\\n").strip("```").strip().replace("\\", "").replace(",n", ",")
        log_data = json.loads(json_str)

        for data in log_data:
            if not isinstance(data, dict):
                raise TypeError("Data must be a dictionary.")

            required_keys = {"Date", "Component", "FailureMode", "Cause", "RepairAction", "Technician"}
            if not required_keys.issubset(data.keys()):
                raise ValueError(f"Data dictionary must contain the following keys: {required_keys}")

            try:
                # Clear existing stats
                db.session.query(ComponentFailure).delete()
                component_failure = ComponentFailure(
                    Date=data["Date"],
                    Component=data["Component"],
                    FailureMode=data["FailureMode"],
                    Cause=data["Cause"],
                    RepairAction=data["RepairAction"],
                    Technician=data["Technician"]
                )
                db.session.add(component_failure)
                db.session.commit()
            except Exception as e:
                print(e)
        # Clear existing stats
        db.session.query(ComponentFailureStats).delete()

        # Insert calculated statistics
        try:
            db.session.execute(
                text("""
                    INSERT INTO component_failure_stats ("Component", "FailureMode", "Cause", "PossibleAction", "Probability", "MTBF")
                    SELECT 
                        cf."Component",
                        cf."FailureMode",
                        cf."Cause",
                        cf."RepairAction" as "PossibleAction",
                        COUNT(*) * 1.0 / (SELECT COUNT(*) FROM component_failure WHERE "Component" = cf."Component") AS "Probability",
                        COALESCE(AVG(EXTRACT(EPOCH FROM (next_failure_date::timestamp - cf."Date"::timestamp)) / 86400.0),0)AS "MTBF"
                    FROM (
                        SELECT 
                            "Component",
                            "FailureMode",
                            "Cause",
                            "RepairAction",
                            "Date", 
                            LEAD("Date") OVER (PARTITION BY "Component", "FailureMode", "Cause" ORDER BY "Date") AS next_failure_date
                        FROM 
                            component_failure
                    ) cf
                    GROUP BY 
                        cf."Component", cf."FailureMode", cf."Cause", cf."RepairAction";
            """)
            )
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            print(f"Error during stats calculation: {e}")
        # output format
        # [
        #     (17, 'Hydraulic system', 'Leak', 'Hose rupture', 'Replaced hydraulic hose', 0.3333333333333333, None),
        #     (18, 'Hydraulic system', 'Leak', 'Seal Wear', 'Replaced the faulty seal', 0.3333333333333333, None),
        #     (19, 'Hydraulic system', 'Pressure drop', 'Fluid leak', 'Replaced hydraulic fluid and seals', 0.3333333333333333, None)
        # ]

        component_failure_stats = db.session.query(ComponentFailureStats).all()
        # Convert stats to list of tuples format
        stats_list = []
        for stat in component_failure_stats:
            stats_list.append((
                stat.id,
                stat.Component,
                stat.FailureMode,
                stat.Cause,
                stat.PossibleAction,
                stat.Probability,
                stat.MTBF
            ))
        return {"data": stats_list}, 200


# generate-fault-tree
class GenerateFaultTreeApi(Resource):

    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument(
            "llm_text",
            nullable=False,
            required=True,
            type=str,
            location="args"
        )
        args = parser.parse_args()
        entities = args["llm_text"].replace("```", "").replace("\\n", "\n")
        print(entities)
        request_data = {
            "fault_tree_text": entities
        }
        url = "https://fta.cognitech-dev.live/generate-fault-tree"
        headers = {
            "accept": "application/json",
            "Content-Type": "application/json"
        }

        response = requests.post(url, json=request_data, headers=headers)
        print(response.json())
        return {"data": response.json()}, 200


api.add_resource(FATTestApi, "/fta/db-handler")
api.add_resource(GenerateFaultTreeApi, "/fta/generate-fault-tree")
