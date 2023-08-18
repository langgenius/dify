# Conversation Application

Conversation applications use a one-question-one-answer mode to have a continuous conversation with the user.

### Applicable scenarios

Conversation applications can be used in fields such as customer service, online education, healthcare, financial services, etc. These applications can help organizations improve work efficiency, reduce labor costs, and provide a better user experience.

### How to compose

Conversation applications supports: prompts, variables, context, opening remarks, and suggestions for the next question.

Here, we use a interviewer application as an example to introduce the way to compose a conversation applications.

#### Step 1 Create an application

Click the "Create Application" button on the homepage to create an application. Fill in the application name, and select **"Chat App"** as the application type.

<figure><img src="../../.gitbook/assets/image (32).png" alt=""><figcaption><p>Create Application</p></figcaption></figure>

#### Step 2: Compose the Application

After the application is successfully created, it will automatically redirect to the application overview page. Click on the left-hand menu: “**Prompt Eng.**”  to compose the application.

<figure><img src="../../.gitbook/assets/image (2).png" alt=""><figcaption></figcaption></figure>



**2.1 Fill in  Prompts**

Prompts are used to give a series of instructions and constraints to the AI response. Form variables can be inserted, such as `{{input}}`. The value of variables in the prompts will be replaced with the value filled in by the user.

The prompt we are filling in here is:

> I want you to be the interviewer for the \{{jobName\}} position. I will be the candidate, and you will ask me interview questions for the position of \{{jobName\}} developer. I hope you will only answer as the interviewer. Don't write all the questions at once. I wish for you to only interview me. Ask me questions and wait for my answers. Don't write explanations. Ask me one by one like an interviewer and wait for my answer.
>
> When I am ready, you can start asking questions.

![](<../../.gitbook/assets/image (38).png>)



For a better experience, we will add an opening dialogue: `"Hello, {{name}}. I'm your interviewer, Bob. Are you ready?"`

To add the opening dialogue, click the "Add Feature" button in the upper left corner, and enable the "Conversation remarkers" feature:

<figure><img src="../../.gitbook/assets/image (21).png" alt=""><figcaption></figcaption></figure>

And then edit the opening remarks:

![](<../../.gitbook/assets/image (15).png>)



**2.2 Adding Context**

If an application wants to generate content based on private contextual conversations, it can use our [dataset](../../advanced/datasets/) feature. Click the "Add" button in the context to add a dataset.

![](<../../.gitbook/assets/image (9).png>)



**2.3 Debugging**

We fill in the user input on the right side and debug the input content.

![](<../../.gitbook/assets/image (11).png>)

If the results are not satisfactory, you can adjust the prompts and model parameters. Click on the model name in the upper right corner to set the parameters of the model:

![](<../../.gitbook/assets/image (29).png>)

We support the GPT-4 model.



**2.4 Publish**

After debugging the application, click the **"Publish"** button in the upper right corner to save the current settings.

### **Share Application**

On the overview page, you can find the sharing address of the application. Click the "Preview" button to preview the shared application. Click the "Share" button to get the sharing link address. Click the "Settings" button to set the shared application information.

<figure><img src="../../.gitbook/assets/image (47).png" alt=""><figcaption></figcaption></figure>



If you want to customize the application that you share, you can Fork our open source [WebApp template](https://github.com/langgenius/webapp-conversation). Based on the template, you can modify the application to meet your specific needs and style requirements.
