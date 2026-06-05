FROM python:3.11-slim

# Security: non-root user
RUN groupadd -r splyntra && useradd -r -g splyntra splyntra

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

COPY . .
RUN chown -R splyntra:splyntra /app

USER splyntra

EXPOSE 8002
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8002"]
