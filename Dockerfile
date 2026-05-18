# Use Node.js as the primary runtime
FROM node:20-slim

WORKDIR /app

# Copy package files and install JS dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Build the React frontend and server
RUN npm run build

# Expose the application port
EXPOSE 3000

# Start the Node.js server
CMD ["npm", "start"]
