FROM python:3.10-slim

WORKDIR /code

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY pages ./pages
COPY alembic ./alembic
COPY alembic.ini .
COPY fix_sequences.sql .

RUN mkdir -p /code/pages/web_backend/data /code/uploads /code/uploads/avatars /code/uploads/attachments

ENV APP_PORT=8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${APP_PORT:-8000}"]
