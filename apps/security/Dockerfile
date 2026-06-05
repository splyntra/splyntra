FROM python:3.11-slim

# Security: non-root user
RUN groupadd -r splyntra && useradd -r -g splyntra splyntra

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir -e ".[injection]" && \
    python -c "import presidio_analyzer; print('presidio OK')"

# Bundle the spaCy model Presidio uses (separate layer keeps the heavy pip
# install above cached when only this changes).
RUN python -m spacy download en_core_web_sm

COPY . .
RUN chown -R splyntra:splyntra /app

USER splyntra

# Run both API server and NATS consumer
EXPOSE 8001
CMD ["sh", "-c", "python -m api.consumer & uvicorn api:app --host 0.0.0.0 --port 8001"]
