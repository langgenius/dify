from controllers.admin import api
from flask import Blueprint
from flask_restful import Api, Resource  # type: ignore


class WatermarkSettings(Resource):
    def get(self):
        """Get watermark settings.
        ---
        tags:
          - admin/api/settings
        summary: Get watermark settings
        description: Get current watermark settings for the system
        security:
          - ApiKeyAuth: []
        responses:
          200:
            description: Watermark settings retrieved successfully
            schema:
              type: object
              properties:
                enabled:
                  type: boolean
                  description: Whether watermark is enabled
          401:
            description: Invalid or missing API key
        """
        pass

    def put(self):
        """Update watermark settings.
        ---
        tags:
          - admin/api/settings
        summary: Update watermark settings
        description: Update system watermark settings
        security:
          - ApiKeyAuth: []
        parameters:
          - name: body
            in: body
            required: true
            schema:
              type: object
              required:
                - enabled
              properties:
                enabled:
                  type: boolean
                  description: Enable or disable watermark
        responses:
          200:
            description: Settings updated successfully
            schema:
              type: object
              properties:
                success:
                  type: boolean
                  example: true
          401:
            description: Invalid or missing API key
        """
        pass


class SystemInfo(Resource):
    def get(self):
        """Get system information.
        ---
        tags:
          - admin/api/settings
        summary: Get system information
        description: Get system version, manual link and other system information
        security:
          - ApiKeyAuth: []
        responses:
          200:
            description: System information retrieved successfully
            schema:
              type: object
              properties:
                version:
                  type: string
                  description: Current system version
                manual_url:
                  type: string
                  description: URL to the user manual (Feishu doc)
                about:
                  type: string
                  description: About information
                agreements:
                  type: array
                  items:
                    type: object
                    properties:
                      title:
                        type: string
                      content:
                        type: string
          401:
            description: Invalid or missing API key
        """
        pass


class OperationLogs(Resource):
    def get(self):
        """Get operation logs.
        ---
        tags:
          - admin/api/settings
        summary: Get operation logs
        description: Get system operation logs with filters
        security:
          - ApiKeyAuth: []
        parameters:
          - name: start_date
            in: query
            type: string
            format: date
            description: Start date for log search
          - name: end_date
            in: query
            type: string
            format: date
            description: End date for log search
          - name: action
            in: query
            type: string
            description: Filter by action type (login, view_stats, view_list, etc)
          - name: operator
            in: query
            type: string
            description: Filter by operator phone number
          - name: page
            in: query
            type: integer
            default: 1
            description: Page number
          - name: per_page
            in: query
            type: integer
            default: 20
            description: Items per page
        responses:
          200:
            description: Operation logs retrieved successfully
            schema:
              type: object
              properties:
                total:
                  type: integer
                  description: Total number of matching logs
                logs:
                  type: array
                  items:
                    type: object
                    properties:
                      id:
                        type: string
                      timestamp:
                        type: string
                        format: date-time
                      operator:
                        type: string
                        description: Phone number of the operator
                      action:
                        type: string
                        description: Action performed
                      target:
                        type: string
                        description: Target of the action
                      details:
                        type: object
                        description: Additional action details
          401:
            description: Invalid or missing API key
          400:
            description: Invalid filter parameters
        """
        pass


api.add_resource(WatermarkSettings, '/settings/watermark')
api.add_resource(SystemInfo, '/settings/info')
api.add_resource(OperationLogs, '/settings/logs')
