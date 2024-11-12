About
FLUX.1 [dev], next generation text-to-image model.

1. Calling the API
#
Setup your API Key
#
Set FAL_KEY as an environment variable in your runtime.


export FAL_KEY="YOUR_API_KEY"
Submit a request
#
The client API handles the API submit protocol. It will handle the request status updates and return the result when the request is completed.


response=$(curl --request POST \
  --url https://queue.fal.run/fal-ai/flux/dev \
  --header "Authorization: Key $FAL_KEY" \
  --header "Content-Type: application/json" \
  --data '{
     "prompt": "Extreme close-up of a single tiger eye, direct frontal view. Detailed iris and pupil. Sharp focus on eye texture and color. Natural lighting to capture authentic eye shine and depth. The word \"FLUX\" is painted over it in big, white brush strokes with visible texture."
   }')
REQUEST_ID=$(echo "$response" | grep -o '"request_id": *"[^"]*"' | sed 's/"request_id": *//; s/"//g')
Request status
Note that the command above will not return the final result, but the process status with its request_id. You can use the Queue API commands specified below to check the status and get the final result.

2. Authentication
#
The API uses an API Key for authentication. It is recommended you set the FAL_KEY environment variable in your runtime when possible.

API Key
#
Protect your API Key
When running code on the client-side (e.g. in a browser, mobile app or GUI applications), make sure to not expose your FAL_KEY. Instead, use a server-side proxy to make requests to the API. For more information, check out our server-side integration guide.

3. Queue
#
Long-running requests
For long-running requests, such as training jobs or models with slower inference times, it is recommended to check the Queue status and rely on Webhooks instead of blocking while waiting for the result.

Submit a request
#
The client API provides a convenient way to submit requests to the model.


response=$(curl --request POST \
  --url https://queue.fal.run/fal-ai/flux/dev \
  --header "Authorization: Key $FAL_KEY" \
  --header "Content-Type: application/json" \
  --data '{
     "prompt": "Extreme close-up of a single tiger eye, direct frontal view. Detailed iris and pupil. Sharp focus on eye texture and color. Natural lighting to capture authentic eye shine and depth. The word \"FLUX\" is painted over it in big, white brush strokes with visible texture."
   }')
REQUEST_ID=$(echo "$response" | grep -o '"request_id": *"[^"]*"' | sed 's/"request_id": *//; s/"//g')
Fetch request status
#
You can fetch the status of a request to check if it is completed or still in progress.


curl --request GET \
  --url https://queue.fal.run/fal-ai/flux/requests/$REQUEST_ID/status \
  --header "Authorization: Key $FAL_KEY"
Get the result
#
Once the request is completed, you can fetch the result. See the Output Schema for the expected result format.


curl --request GET \
  --url https://queue.fal.run/fal-ai/flux/requests/$REQUEST_ID \
  --header "Authorization: Key $FAL_KEY"
4. Files
#
Some attributes in the API accept file URLs as input. Whenever that's the case you can pass your own URL or a Base64 data URI.

Data URI (base64)
#
You can pass a Base64 data URI as a file input. The API will handle the file decoding for you. Keep in mind that for large files, this alternative although convenient can impact the request performance.

Hosted files (URL)
#
You can also pass your own URLs as long as they are publicly accessible. Be aware that some hosts might block cross-site requests, rate-limit, or consider the request as a bot.

Uploading files
#
We provide a convenient file storage that allows you to upload files and use them in your requests. You can upload files using the client API and use the returned URL in your requests.

Not available
This functionality is not available on this client.
Read more about file handling in our file upload guide.

5. Schema
#
Input
#
prompt string
The prompt to generate an image from.

image_size ImageSize | Enum
The size of the generated image. Default value: landscape_4_3

Possible enum values: square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9

Note: For custom image sizes, you can pass the width and height as an object:


"image_size": {
  "width": 1280,
  "height": 720
}
num_inference_steps integer
The number of inference steps to perform. Default value: 28

seed integer
The same seed and the same prompt given to the same version of the model will output the same image every time.

guidance_scale float
The CFG (Classifier Free Guidance) scale is a measure of how close you want the model to stick to your prompt when looking for a related image to show you. Default value: 3.5

sync_mode boolean
If set to true, the function will wait for the image to be generated and uploaded before returning the response. This will increase the latency of the function but it allows you to get the image directly in the response without going through the CDN.

num_images integer
The number of images to generate. Default value: 1

enable_safety_checker boolean
If set to true, the safety checker will be enabled. Default value: true


{
  "prompt": "Extreme close-up of a single tiger eye, direct frontal view. Detailed iris and pupil. Sharp focus on eye texture and color. Natural lighting to capture authentic eye shine and depth. The word \"FLUX\" is painted over it in big, white brush strokes with visible texture.",
  "image_size": "landscape_4_3",
  "num_inference_steps": 28,
  "guidance_scale": 3.5,
  "num_images": 1,
  "enable_safety_checker": true
}
Output
#
images list<Image>
The generated image files info.

timings Timings
seed integer
Seed of the generated Image. It will be the same value of the one passed in the input or the randomly generated that was used in case none was passed.

has_nsfw_concepts list<boolean>
Whether the generated images contain NSFW concepts.

prompt string
The prompt used for generating the image.


{
  "images": [
    {
      "url": "",
      "content_type": "image/jpeg"
    }
  ],
  "prompt": ""
}
Other types
#
ImageSize
#
width integer
The width of the generated image. Default value: 512

height integer
The height of the generated image. Default value: 512

Image
#
url string
width integer
height integer
content_type string
Default value: "image/jpeg"