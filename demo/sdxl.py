from diffusers import AutoPipelineForText2Image
import torch
import streamlit as st
from PIL import Image

# pipe = AutoPipelineForText2Image.from_pretrained("stabilityai/sdxl-turbo") #, torch_dtype=torch.float16, variant="fp16"
# pipe.to("cpu")

# prompt = "A cinematic shot of a baby racoon wearing an intricate italian priest robe."

# image = pipe(prompt=prompt, num_inference_steps=1, guidance_scale=0.0).images[0]

# # save image to disk
# image.save("output.png") 



st.title("Text-to-Image Demo")
st.write("Enter a prompt and generate an image!")

# Load the text-to-image pipeline
pipe = AutoPipelineForText2Image.from_pretrained("stabilityai/sdxl-turbo")
pipe.to("cpu")

# Prompt input
prompt = st.text_input("Enter a prompt")

# Generate image on button click
if st.button("Generate"):
    image = pipe(prompt=prompt, num_inference_steps=1, guidance_scale=0.0).images[0]
    st.image(image, caption="Generated Image", use_column_width=True)

    # Save image to disk
    # image.save("output.png")