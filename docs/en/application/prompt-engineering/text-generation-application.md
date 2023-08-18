# Text Generator

Text generation applications are applications that can automatically generate high-quality text based on prompts provided by users. They can generate various types of text, such as article summaries, translations, etc.

### **Applicable scenarios**

Text generation applications are suitable for scenarios that require a large amount of text creation, such as news media, advertising, SEO, marketing, etc. They can provide efficient and fast text generation services for these industries, reduce labor costs, and improve production efficiency.

### **How to c**ompose

Text generation applications supports: prefix prompt words, variables, context, and generating more similar content.

Here, we use a translation application as an example to introduce the way to compose a text generation applications.

#### **Step 1: Create the application**

Click the "Create Application" button on the homepage to create an application. Fill in the application name, and select "Text Generator" as the application type.

<figure><img src="../../.gitbook/assets/image (28).png" alt=""><figcaption><p>Create Application</p></figcaption></figure>

#### Step 2: Compose the Application

After the application is successfully created, it will automatically redirect to the application overview page. Click on the left-hand menu: “**Prompt Eng.**” to compose the application.

<figure><img src="../../.gitbook/assets/image (50).png" alt=""><figcaption></figcaption></figure>

**2.1 Fill in Prefix Prompts**

Prompts are used to give a series of instructions and constraints to the AI response. Form variables can be inserted, such as `{{input}}`. The value of variables in the prompts will be replaced with the value filled in by the user.

The prompt we are filling in here is: `Translate the content to: {{language}}. The content is as follows:`

![](<../../.gitbook/assets/image (7).png>)



**2.2 Adding Context**

If the application wants to generate content based on private contextual conversations, our [dataset](../../advanced/datasets/) feature can be used. Click the "Add" button in the context to add a dataset.

![](<../../.gitbook/assets/image (12).png>)



**2.3 Adding Future: Generate more like this**

Generating more like this allows you to generate multiple texts at once, which you can edit and continue generating from. Click on the "Add Future" button in the upper left corner to enable this feature.

<figure><img src="../../.gitbook/assets/image (35).png" alt=""><figcaption></figcaption></figure>

**2.4 Debugging**

We debug on the right side by entering variables and querying content. Click the "Run" button to view the results of the operation.

![](<../../.gitbook/assets/image (17).png>)

If the results are not satisfactory, you can adjust the prompts and model parameters. Click on the model name in the upper right corner to set the parameters of the model:

![](<../../.gitbook/assets/image (36).png>)



**2.5 Publish**

After debugging the application, click the **"Publish"** button in the upper right corner to save the current settings.

### **Share Application**

You can find the sharing address of the application on the overview page. Click the "Preview" button to preview the shared application. Click the "Share" button to obtain the sharing link address. Click the "Settings" button to set the information of the shared application.

<figure><img src="../../.gitbook/assets/image (52).png" alt=""><figcaption></figcaption></figure>

If you want to customize the application shared outside, you can Fork our open source [WebApp template](https://github.com/langgenius/webapp-text-generator). Based on the template, you can modify the application to meet your specific situation and style requirements.



