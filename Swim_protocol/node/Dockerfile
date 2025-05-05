FROM node:14
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 60051
CMD ["sh", "-c", "node dissemination.js $NODE_ID $PORT"]
