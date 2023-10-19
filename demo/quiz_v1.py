import os
import json
import streamlit as st
import openai
from dotenv import load_dotenv

load_dotenv()

def complete_text(prompt: str) -> str:
    openai.api_base = os.getenv("OPENAI_API_BASE")
    openai.api_key = os.getenv("OPENAI_SECRET_KEY")
    openai.api_type = os.getenv("OPENAI_API_TYPE")
    openai.api_version = "2023-07-01-preview"
    messages = [{"role": "user", "content": prompt}]
    return openai.ChatCompletion.create(engine=os.getenv('OPENAI_API_DEPOLY'), messages=messages)["choices"][0]["message"]["content"]

def prepare_prompt(topics: str, number_of_questions: int, number_of_answers: int) -> str:
    return ('Create a quiz of multiple choice questions with '+str(number_of_questions)+' questions and '+str(number_of_answers)+' of possible answers in each question. The exam should be about '+topics+'. Only generate the questions and answers using the following json format: {"quiz":[{"question": "...?","answers": [ {"a": "..."}, {"b": "..."}, {"c": "..."}, {"d": "..."}], "correct_answer": "c"},...]}, do not generate anything else.')

def get_questions(topics: str, number_of_questions: int, number_of_answers: int):
    prompt = prepare_prompt(topics, number_of_questions, number_of_answers)
    response = complete_text(prompt)
    return json.loads(response)

class QuizView:
  def render():
      st.title("Quiz Generator version 1")
      topics = st.text_input("Topics",value="python",placeholder="Topics to include in the quiz",help="It is recommended to use a comma-separated list of topics")
      number_of_questions = st.number_input("Number of questions",min_value=1,max_value=30,value=3,help="Number of questions that will be generated")
      number_of_answers = st.number_input("Number of answers",min_value=3,max_value=5,value=4,help="Number of possible answers that will be generated for each question")
      questions = None
      if st.button("Generate", help="Generate the questions according to the parameters"):
          st.warning("Generating questions. This may take a while...")
          try:
              questions = get_questions(topics, number_of_questions, number_of_answers)
          except Exception:
              st.error("An error occurred while generating the questions. Please try again")
      if questions is not None:
          st.title("Questions preview")
          for question in questions['quiz']:
              answers = ([f"{key}. {value}" for answer in question['answers'] for key, value in answer.items()]) 
              answer = st.radio(f"**{question['question']}**", answers, index=None, disabled=True)
              st.write("Correct Answer: "+question['correct_answer'])
          st.write(questions)

QuizView.render()