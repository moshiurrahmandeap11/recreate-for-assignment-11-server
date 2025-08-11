# ⚙️ Coursion Server

A powerful and secure Node.js + Express backend for **Coursion** — the online course management platform.  
Handles authentication, course management, and real-time enrollment with MongoDB integration.

---

## 🌐 Live API Endpoint

👉 <a href="https://coursion-server.vercel.app" target="_blank">https://coursion-server.vercel.app/</a>

---
## LIVE SITE
<a href="https://coursion-9faf6.web.app/" target="_blank">LIVE</a>
---


---

## 🧠 Core Features

✅ RESTful APIs for Courses, Users, and Enrollments  
✅ JWT-based authentication system  
✅ Course creation with seat limit & instructor info  
✅ Enrollment API with max 3 course limit per user  
✅ MongoDB-based dynamic storage
✅ CORS-enabled, cookie-based token flow  
✅ Centralized error handling & clean API response format  

---

## 🛠 Technologies Used

- **Node.js** & **Express**
- **MongoDB**
- **JWT** (JSON Web Token)
- **dotenv**
- **cors**
- **cookie-parser**

---

## 🔐 Authentication

- Login and register users with email/password
- Generate & verify JWT tokens
- Secure routes with middleware
- Store JWT token in cookies for client access

---

## 🔄 API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/courses` | Get all courses |
| `POST` | `/courses` | Add new course |
| `PATCH` | `/courses/:id` | Update course info |
| `DELETE` | `/courses/:id` | Delete a course |
| `GET` | `/enrollments/:email` | Get enrolled courses |
| `POST` | `/jwt` | Create JWT token |
| `POST` | `/users` | Register new user |

> 🔐 Some routes require JWT authorization in the request header or via cookies.

---

## 🚀 Getting Started Locally

```bash
# 1. Clone the repo
git clone https://github.com/moshiurrahmandeap11/coursion-server
cd coursion-server

# 2. Install dependencies
npm install

# 3. Create .env file based on example
cp .env.example .env

# 4. Fill in the .env file:
#username
#password
# JWT_SECRET=your_secret_key
#FB_SECRET_KEY

# 5. Start the server
nodemon index.js

# Server will run on:
http://localhost:3000
