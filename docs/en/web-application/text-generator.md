# Text Generator

The text generation application is an application that automatically generates high-quality text according to the prompts provided by the user. It can generate various types of text, such as article summaries, translations, etc.



Text generation applications support the following features:

1. Run it once.
2. Run in batches.
3. Save the run results.
4. Generate more similar results.

Let's introduce them separately.



### Run it once

Enter the query content, click the run button, and the result will be generated on the right, as shown in the following figure:

<figure><img src="../.gitbook/assets/image (57).png" alt=""><figcaption></figcaption></figure>

In the generated results section, click the "Copy" button to copy the content to the clipboard. Click the "Save" button to save the content. You can see the saved content in the "Saved" tab. You can also "like" and "dislike" the generated content.

### Run in batches

Sometimes, we need to run an application many times. For example: There is a web application that can generate articles based on topics. Now we want to generate 100 articles on different topics. Then this task has to be done 100 times, which is very troublesome. Also, you have to wait for one task to complete before starting the next one.

In the above scenario, the batch operation function is used, which is convenient to operate (enter the theme into a `csv` file, only need to be executed once), and also saves the generation time (multiple tasks run at the same time). The usage is as follows:

#### Step 1 Enter the batch run page

Click the "Run Batch" tab to enter the batch run page.

<figure><img src="../.gitbook/assets/image (27).png" alt=""><figcaption></figcaption></figure>

#### Step 2 Download the template and fill in the content

Click the Download Template button to download the template. Edit the template, fill in the content, and save as a `.csv` file.

<figure><img src="../.gitbook/assets/image (13).png" alt=""><figcaption></figcaption></figure>

#### Step 3 Upload the file and run

<figure><img src="../.gitbook/assets/image (55).png" alt=""><figcaption></figcaption></figure>

If you need to export the generated content, you can click the download "button" in the upper right corner to export as a `csv` file.

### Save run results

Click the "Save" button below the generated results to save the running results. In the "Saved" tab, you can see all saved content.

<figure><img src="../.gitbook/assets/image (6).png" alt=""><figcaption></figcaption></figure>

### Generate more similar results

If the "more similar" function is turned on when applying the arrangement. Clicking the "more similar" button in the web application generates content similar to the current result. As shown below:

<figure><img src="../.gitbook/assets/image (22).png" alt=""><figcaption></figcaption></figure>
