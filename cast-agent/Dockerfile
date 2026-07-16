FROM python:3.13.5-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt
COPY server.py ./

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import socket; s=socket.socket(socket.AF_UNIX); s.settimeout(3); s.connect('/run/plum-cast/agent.sock'); s.sendall(b'GET /v1/health HTTP/1.1\\r\\nHost: local\\r\\nConnection: close\\r\\n\\r\\n'); data=b''.join(iter(lambda:s.recv(4096),b'')); raise SystemExit(0 if b'200 OK' in data and b'\\\"ok\\\":true' in data else 1)"]

CMD ["python", "/app/server.py"]
