FROM python:3.12-slim@sha256:02108f5d322dd89f1c9e552442c25acb0543dfdbc455693a5599624f20d9155d
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 MPLBACKEND=Agg
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libegl1 libglib2.0-0 openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.lock .
RUN pip install --only-binary=:all: --require-hashes --no-cache-dir -r requirements.lock
RUN apt-get update && apt-get install -y --no-install-recommends libgles2 && rm -rf /var/lib/apt/lists/*
COPY . .
RUN useradd --uid 10001 --create-home inference
USER inference
CMD ["python", "server.py"]
