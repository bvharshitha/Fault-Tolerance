FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 50051
CMD ["sh", "-c", "python failure_detector.py $NODE_ID $PORT \"$MEMBERSHIP_LIST\""]
