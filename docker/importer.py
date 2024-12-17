import meilisearch
import csv
import os

client = meilisearch.Client('http://localhost:7700', os.environ['MEILI_MASTER_KEY'])

# Open CSV File

# Double check data formatting
#   "id:number","title:string","genres:string","release-year:number"
#   "1564","Kung Fu Panda","Children's Animation","2008"
client.index('inventory').delete()
client.create_index('inventory', {'primaryKey': 'SKU' })

def get_status(quantity:str) -> str:
    if (int(quantity) == 0):
        return "Out of Stock"
    else: 
        return "In stock"

def process_bullets(bullets:str) -> str:
    if (bullets is not None):
        names = bullets.split('<bullet name="')
        return '\n'.join([name.split('" />')[0] for name in names])

with open ('fabric_inv.csv', 'r') as inv_file:
    reader = csv.reader(inv_file)

    for index, row in enumerate(reader):
        if index == 0:
            continue  # Skip header row
        task = client.index('inventory').update_documents([{
            "SKU": row[0],
            "Available": row[1],
            "Name": row[2],
            "Color": row[3],
            "ProductBullets": process_bullets(row[4]),
            "Status": get_status(row[1])  # Add status field based on quantity value
        }])
        print('Updating SKU ' + row[0] + ' is being tracked by task ', task)
