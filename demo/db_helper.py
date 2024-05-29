import sqlite3

conn = sqlite3.connect('quiz.db')
cursor = conn.cursor()
cursor.execute('''CREATE TABLE IF NOT EXISTS questions
                    (id INTEGER PRIMARY KEY AUTOINCREMENT,
                    question TEXT,
                    answers TEXT,
                    correct_answer TEXT)''')
cursor.execute('''INSERT INTO questions (question, answers, correct_answer) VALUES (?, ?, ?)''',
               ('qqqq', 'aaaa', 'cccc'))
conn.commit()
conn.close()
new_question_id = cursor.lastrowid
print(new_question_id)
