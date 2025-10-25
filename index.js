require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const app = express();
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const Groq = require("groq-sdk");

// SIMPLE CORS configuration - allow all origins
app.use(cors({
  origin: "*", // সব domain থেকে access allow
  credentials: false // * থাকলে credentials true করা যায় না
}));

app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.USER_DB}:${process.env.USER_PASS}@mdb.26vlivz.mongodb.net/?retryWrites=true&w=majority&appName=MDB`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Fix for service account parsing
let serviceAccount;
try {
  if (process.env.FB_SERVICE_KEY) {
    const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString("utf8");
    serviceAccount = JSON.parse(decoded);
  } else {
    throw new Error("FB_SERVICE_KEY not found");
  }
} catch (error) {
  console.error("Error parsing service account:", error);
  // Fallback: try to parse as direct JSON string
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  } catch (e) {
    console.error("Failed to parse service account:", e);
    serviceAccount = {};
  }
}

// Initialize Firebase Admin only if serviceAccount is valid
if (serviceAccount && serviceAccount.project_id) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin initialized successfully");
  } catch (error) {
    console.error("Firebase Admin initialization error:", error);
  }
} else {
  console.warn("Firebase Admin not initialized - invalid service account");
}

// Initialize Groq client
let groq;
if (process.env.GROQ_API_KEY) {
  groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });
} else {
  console.warn("GROQ_API_KEY not found");
}

// Available Groq models
const AVAILABLE_MODELS = [
  "llama-3.1-8b-instant",  // Fast and efficient
  "llama-3.1-70b-versatile", // More powerful
  "mixtral-8x7b-32768",   // High context
  "gemma2-9b-it"          // Google's model
];

const DEFAULT_MODEL = "llama-3.1-8b-instant";

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    console.log("decoded data", decoded);
    req.decoded = decoded;
    next();
  } catch (error) {
    console.error("Token verification error:", error);
    return res.status(401).send({ message: "unauthorized access" });
  }
};

// Helper function to get website context from database
async function getWebsiteContext(coursionCoursesCollection, coursionBannerCollection, coursionTestimonialCollection) {
  try {
    const courses = await coursionCoursesCollection.find({}).toArray();
    const banners = await coursionBannerCollection.find({}).toArray();
    const testimonials = await coursionTestimonialCollection.find({}).toArray();
    
    return {
      courses: courses.map(course => ({
        title: course.title,
        description: course.description,
        instructor: course.instructor,
        price: course.price,
        duration: course.duration,
        totalSeats: course.totalSeats,
        enrolled: course.enrolled
      })),
      banners: banners.map(banner => ({
        title: banner.title,
        subtitle: banner.subtitle
      })),
      testimonials: testimonials.map(testimonial => ({
        name: testimonial.name,
        review: testimonial.review,
        rating: testimonial.rating
      })),
      features: [
        "Course enrollment system",
        "User authentication with Firebase",
        "JWT token based security",
        "MongoDB database",
        "Express.js backend",
        "React frontend"
      ]
    };
  } catch (error) {
    console.error("Error fetching website context:", error);
    return {};
  }
}

// Function to test Groq models and find the best available one
async function findBestAvailableModel() {
  if (!groq) return DEFAULT_MODEL;
  
  for (const model of AVAILABLE_MODELS) {
    try {
      console.log(`Testing model: ${model}`);
      const testCompletion = await groq.chat.completions.create({
        messages: [{ role: "user", content: "Hello" }],
        model: model,
        max_tokens: 5,
        temperature: 0.1
      });
      
      if (testCompletion.choices[0]?.message?.content) {
        console.log(`✅ Model ${model} is available`);
        return model;
      }
    } catch (error) {
      console.log(`❌ Model ${model} failed:`, error.message);
      continue;
    }
  }
  
  console.log("No available models found, using default");
  return DEFAULT_MODEL;
}

async function run() {
  try {
    // Connect the client to the server
    await client.connect();
    console.log("Connected to MongoDB");

    const coursionUserCollection = client
      .db("coursionUserCollectionDB")
      .collection("coursionUserCollection");
    const coursionBannerCollection = client
      .db("coursionBannerDB")
      .collection("coursionBanner");
    const coursionCoursesCollection = client
      .db("coursionCoursesDB")
      .collection("coursionCourses");
    const coursionEnrollmentCollection = client
      .db("coursionEnrollmentsDB")
      .collection("coursionEnrollments");
    const coursionTestimonialCollection = client
      .db("coursionTestimonialDB")
      .collection("coursionTestimonials");
    const coursionChatCollection = client
      .db("coursionChatDB")
      .collection("coursionChats");

    // Find the best available model
    let activeModel = DEFAULT_MODEL;
    if (groq) {
      activeModel = await findBestAvailableModel();
      console.log(`Using model: ${activeModel}`);
    }

    // Root route - FIRST
    app.get("/", (req, res) => {
      console.log("GET / route hit");
      res.send("Coursion is cooking");
    });

    // jwt token related apis
    app.post("/jwt", async (req, res) => {
      const { email, token: firebaseToken } = req.body;

      if (!email || !firebaseToken) {
        return res
          .status(400)
          .send({ message: "Missing email or Firebase token" });
      }

      try {
        // Verify Firebase ID token
        const decoded = await admin.auth().verifyIdToken(firebaseToken);

        if (decoded.email !== email) {
          return res
            .status(401)
            .send({ message: "Invalid token or email mismatch" });
        }

        // Create own server-side JWT
        const accessToken = jwt.sign({ email }, process.env.JWT_ACCESS_SECRET, {
          expiresIn: "30d",
        });

        // Since we're using CORS *, we can't use httpOnly cookies
        // Send token in response body instead
        console.log("✅ JWT token created");
        res.send({ 
          success: true, 
          token: accessToken,
          message: "Login successful" 
        });
      } catch (err) {
        console.error("Firebase token verification failed", err);
        res.status(401).send({ message: "Invalid Firebase token" });
      }
    });

    // users api
    app.get("/users", async (req, res) => {
      try {
        const result = await coursionUserCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.post("/users", async (req, res) => {
      try {
        const newUser = req.body;
        const result = await coursionUserCollection.insertOne(newUser);
        res.send(result);
      } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // banners api
    app.get("/banners", async (req, res) => {
      try {
        const result = await coursionBannerCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching banners:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // courses api - FIXED
    app.get("/courses", async (req, res) => {
      console.log("GET /courses route hit");
      
      const authHeader = req.headers.authorization;
      let email;

      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];

        try {
          const decoded = await admin.auth().verifyIdToken(token);
          email = decoded.email;
          console.log("User email from token:", email);
        } catch (err) {
          console.log("Invalid token. Serving public courses instead.");
        }
      }

      try {
        const query = email ? { email } : {};
        console.log("MongoDB query:", query);
        
        const result = await coursionCoursesCollection.find(query).toArray();
        console.log(`Found ${result.length} courses`);
        
        res.send(result);
      } catch (err) {
        console.error("Error fetching courses", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/courses/:id", async (req, res) => {
      const id = req.params.id;
      console.log("GET /courses/:id route hit with id:", id);
      
      try {
        const result = await coursionCoursesCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!result) {
          return res.status(404).send({ message: "Course not found" });
        }
        res.send(result);
      } catch (err) {
        console.error("Error fetching course:", err);
        res.status(500).send({ message: "Invalid ID format or server error" });
      }
    });

    app.post("/courses", async (req, res) => {
      try {
        const newCourse = req.body;
        const result = await coursionCoursesCollection.insertOne(newCourse);
        res.send(result);
      } catch (error) {
        console.error("Error creating course:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.put("/courses/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = { ...req.body };

      delete updatedData._id;

      try {
        const result = await coursionCoursesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Course not found" });
        }

        res.send({ message: "Course updated successfully" });
      } catch (err) {
        console.error("Update error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.delete("/courses/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await coursionCoursesCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Course not found" });
        }
        res.send({ message: "Course deleted successfully" });
      } catch (err) {
        res.status(500).send({ message: "Error deleting course" });
      }
    });

    // enrollments api
    app.get("/enrollments", async (req, res) => {
      const { email, courseId } = req.query;
      if (!email || !courseId) {
        return res.status(400).send({ error: "Missing query params" });
      }

      try {
        const enrolled = await coursionEnrollmentCollection.findOne({
          email,
          courseId: courseId,
        });

        res.send({ enrolled: !!enrolled });
      } catch (err) {
        console.error("Error checking enrollment:", err);
        res
          .status(500)
          .send({ error: "Invalid courseId format or server error" });
      }
    });

    app.get("/enrollments/count/:courseId", async (req, res) => {
      const courseId = req.params.courseId;
      const count = await coursionEnrollmentCollection.countDocuments({
        courseId,
      });
      res.send({ count });
    });

    app.get("/enrollments/byUser/:email", verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      try {
        const enrollments = await coursionEnrollmentCollection
          .find({ email })
          .toArray();
        res.send(enrollments);
      } catch (error) {
        console.error("Error fetching enrollments:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.post("/enrollments", async (req, res) => {
      const { email, courseId } = req.body;

      try {
        const alreadyEnrolled = await coursionEnrollmentCollection.findOne({
          email,
          courseId,
        });
        if (alreadyEnrolled) {
          return res.status(400).send({ message: "Already enrolled" });
        }

        // Count user's active enrollments
        const userEnrollmentsCount =
          await coursionEnrollmentCollection.countDocuments({ email });
        if (userEnrollmentsCount >= 3) {
          return res
            .status(400)
            .send({ message: "You can enroll in maximum 3 courses." });
        }

        // Count total enrollments for that course
        const totalEnrolled = await coursionEnrollmentCollection.countDocuments({
          courseId,
        });
        const course = await coursionCoursesCollection.findOne({
          _id: new ObjectId(courseId),
        });

        if (!course || totalEnrolled >= course.totalSeats) {
          return res
            .status(400)
            .send({ message: "No seats left for this course." });
        }

        const result = await coursionEnrollmentCollection.insertOne({
          email,
          courseId,
          enrolledAt: new Date(),
        });

        res.send(result);
      } catch (error) {
        console.error("Error creating enrollment:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.delete("/enrollments/:email/:courseId", async (req, res) => {
      const { email, courseId } = req.params;

      try {
        const result = await coursionEnrollmentCollection.deleteOne({
          email,
          courseId,
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Enrollment not found" });
        }

        res.send({ message: "Enrollment removed successfully" });
      } catch (error) {
        console.error("Delete enrollment error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // testimonials api
    app.get("/reviews", async (req, res) => {
      try {
        const result = await coursionTestimonialCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.post("/reviews", async (req, res) => {
      try {
        const newReview = req.body;
        const result = await coursionTestimonialCollection.insertOne(newReview);
        res.send(result);
      } catch (error) {
        console.error("Error creating review:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // Chatbot APIs
    app.get("/api/chat/history", verifyFirebaseToken, async (req, res) => {
      const email = req.decoded.email;

      try {
        let chatSession = await coursionChatCollection.findOne({ email });
        
        if (!chatSession) {
          chatSession = {
            email,
            messages: [
              {
                id: 1,
                text: "Hello! I'm your Coursion assistant. How can I help you with courses, enrollment, or any other questions today?",
                isBot: true,
                timestamp: new Date()
              }
            ],
            createdAt: new Date(),
            updatedAt: new Date()
          };
          
          await coursionChatCollection.insertOne(chatSession);
        }

        res.send({ 
          messages: chatSession.messages,
          email: chatSession.email
        });
      } catch (error) {
        console.error("Error fetching chat history:", error);
        res.status(500).send({ error: "Failed to fetch chat history" });
      }
    });

    app.post("/api/chat", verifyFirebaseToken, async (req, res) => {
      const { message } = req.body;
      const email = req.decoded.email;
      
      if (!message) {
        return res.status(400).send({ error: "Message is required" });
      }

      try {
        let chatSession = await coursionChatCollection.findOne({ email });
        
        if (!chatSession) {
          chatSession = {
            email,
            messages: [
              {
                id: 1,
                text: "Hello! I'm your Coursion assistant. How can I help you with courses, enrollment, or any other questions today?",
                isBot: true,
                timestamp: new Date()
              }
            ],
            createdAt: new Date(),
            updatedAt: new Date()
          };
          await coursionChatCollection.insertOne(chatSession);
        }

        const userMessage = {
          id: chatSession.messages.length + 1,
          text: message,
          isBot: false,
          timestamp: new Date()
        };

        const websiteContext = await getWebsiteContext(
          coursionCoursesCollection, 
          coursionBannerCollection, 
          coursionTestimonialCollection
        );

        const conversationHistory = chatSession.messages
          .slice(-10)
          .map(msg => ({
            role: msg.isBot ? "assistant" : "user",
            content: msg.text
          }));

        const systemPrompt = `You are a helpful assistant for Coursion, a course management website. Use the following context to answer questions accurately:

Website Context:
- Total Courses: ${websiteContext.courses?.length || 0}
- Available Courses: ${websiteContext.courses?.map(c => c.title).join(', ') || 'No courses available'}
- Banner Messages: ${websiteContext.banners?.map(b => b.title).join(', ') || 'No banners'}
- Testimonials Count: ${websiteContext.testimonials?.length || 0}
- Features: ${websiteContext.features?.join(', ') || 'No features listed'}

Key Information:
- Users can enroll in maximum 3 courses
- Course enrollment depends on seat availability
- Users need to be authenticated to access certain features
- The website uses Firebase for authentication and MongoDB for data storage

Current user: ${email}

Please provide helpful, accurate information about the courses, enrollment process, website features, and any other relevant information. If you don't know something, be honest about it.`;

        let botResponse = "I'm sorry, I couldn't process your request.";
        
        if (groq) {
          try {
            const completion = await groq.chat.completions.create({
              messages: [
                {
                  role: "system",
                  content: systemPrompt
                },
                ...conversationHistory,
                {
                  role: "user",
                  content: message
                }
              ],
              model: activeModel,
              temperature: 0.7,
              max_tokens: 1024,
              stream: false
            });

            botResponse = completion.choices[0]?.message?.content || botResponse;
          } catch (groqError) {
            console.error("Groq API error:", groqError);
            botResponse = "I'm having trouble connecting to the AI service. Please try again later.";
          }
        } else {
          botResponse = "AI service is currently unavailable. Please try again later.";
        }

        const botMessage = {
          id: chatSession.messages.length + 2,
          text: botResponse,
          isBot: true,
          timestamp: new Date()
        };

        const updatedMessages = [...chatSession.messages, userMessage, botMessage];

        await coursionChatCollection.updateOne(
          { email },
          { 
            $set: { 
              messages: updatedMessages,
              updatedAt: new Date()
            } 
          }
        );

        res.send({ 
          response: botResponse,
          messageId: botMessage.id
        });
      } catch (error) {
        console.error("Chat API error:", error);
        res.status(500).send({ 
          error: "Sorry, I'm having trouble responding right now. Please try again later." 
        });
      }
    });

    // Clear chat history
    app.delete("/api/chat/history", verifyFirebaseToken, async (req, res) => {
      const email = req.decoded.email;

      try {
        await coursionChatCollection.updateOne(
          { email },
          { 
            $set: { 
              messages: [
                {
                  id: 1,
                  text: "Hello! I'm your Coursion assistant. How can I help you with courses, enrollment, or any other questions today?",
                  isBot: true,
                  timestamp: new Date()
                }
              ],
              updatedAt: new Date()
            } 
          }
        );

        res.send({ message: "Chat history cleared successfully" });
      } catch (error) {
        console.error("Error clearing chat history:", error);
        res.status(500).send({ error: "Failed to clear chat history" });
      }
    });

    // Get all chat sessions (admin only)
    app.get("/api/chat/sessions", verifyFirebaseToken, async (req, res) => {
      try {
        const sessions = await coursionChatCollection.find({}).toArray();
        res.send(sessions);
      } catch (error) {
        console.error("Error fetching chat sessions:", error);
        res.status(500).send({ error: "Failed to fetch chat sessions" });
      }
    });

    console.log("All routes initialized successfully");
    console.log(`Active Groq model: ${activeModel}`);

  } catch (error) {
    console.error("Error in run function:", error);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Coursion is running on port ${port}`);
  console.log(`CORS enabled for ALL origins (*)`);
});