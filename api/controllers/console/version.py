
import json
import logging

import requests
from flask import current_app
from flask_restful import Resource, reqparse

from . import api


class VersionApi(Resource):

    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument('current_version', type=str, required=True, location='args')
        args = parser.parse_args()
        check_update_url = current_app.config['CHECK_UPDATE_URL']

        if not check_update_url:
            return {
                'version': '0.0.0',
                'release_date': '',
                'release_notes': '',
                'can_auto_update': False
            }

        try:
            response = requests.get(check_update_url, {
                'current_version': args.get('current_version')
            })
        except Exception as error:
            logging.warning("Check update version error: {}.".format(str(error)))
            return {
                'version': args.get('current_version'),
                'release_date': '',
                'release_notes': '',
                'can_auto_update': False
            }

        content = json.loads(response.content)
        return {
            'version': content['version'],
            'release_date': content['releaseDate'],
            'release_notes': content['releaseNotes'],
            'can_auto_update': content['canAutoUpdate']
        }


api.add_resource(VersionApi, '/version')
