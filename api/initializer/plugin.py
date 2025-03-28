import os
import logging
import asyncio
import threading

from functools import partial
from configs import dify_config
from services.plugin.plugin_service import PluginService
from .admin import get_admin
from .decorator import initializer

PLUGIN_CHECK_INTERVAL = 180

plugin_ids = []
plugin_unique_identifiers = []

@initializer(priority=4)
def init_plugin():
    plugin_dir = './init_data/plugins/packages'

    if not os.path.isdir(plugin_dir):
        logging.error(f"Invalid directory: {plugin_dir}")
        return
    
    admin = get_admin()

    for file_entry in os.scandir(plugin_dir):
        if not file_entry.name.endswith('.difypkg') or file_entry.name.startswith('.'):
            continue

        try:
            with open(file_entry.path, 'rb') as file:

                file_size = os.fstat(file.fileno()).st_size
                if file_size > dify_config.PLUGIN_MAX_PACKAGE_SIZE:
                    logging.error(f"File size exceeds the limit: {file_entry.path}")
                    continue
                response = PluginService.upload_pkg(admin.current_tenant_id, file.read())

                plugin_id = _get_plugin_id(response.unique_identifier)
                installations = PluginService.list_installations_from_ids(admin.current_tenant_id, [plugin_id])
                if len(installations) > 0:
                    # Plugin already installed
                    continue

                plugin_ids.append(plugin_id)
                plugin_unique_identifiers.append(response.unique_identifier)

                PluginService.install_from_local_pkg(admin.current_tenant_id, [response.unique_identifier])

        except Exception as e:
            logging.error(f"Failed to install plugin: {file_entry.path} {str(e)}")

    if not dify_config.OFFLINE_MODE:
        threading.Thread(
            target=partial(_run_async_activation, admin.current_tenant_id), 
            daemon=True
        ).start()

def _get_plugin_id(plugin_unique_identifier: str) -> str:
    return plugin_unique_identifier.split(':')[0]
    
def _run_async_activation(tenant_id: str):
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(_activate_plugin(tenant_id))
    except Exception as e:
        logging.error(f"Async activation crashed: {str(e)}")

async def _activate_plugin(tenant_id: str):
    max_retries = 10
    retry_count = 0
    
    while retry_count < max_retries:
        try:
            await asyncio.sleep(PLUGIN_CHECK_INTERVAL)

            installations = PluginService.list_installations_from_ids(tenant_id, plugin_ids)
            if len(installations) == len(plugin_ids):
                logging.info("All plugins activated")
                return
                
            for id in plugin_unique_identifiers:
                installed = False
                for installation in installations:
                    if installation.plugin_unique_identifier == id:
                        installed = True
                        break
                if not installed:
                    PluginService.install_from_local_pkg(tenant_id, [id])

            retry_count += 1
            
        except Exception as e:
            logging.error(f"Activation failed: {str(e)}")
            
    logging.error("Plugin activation timeout")