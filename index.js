require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const app = express();
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

app.use(
  cors({
    origin: ["https://coursion-9faf6.web.app", "http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.USER_DB}:${process.env.USER_PASS}@mdb.26vlivz.mongodb.net/?retryWrites=true&w=majority&appName=MDB`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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
    return res.status(401).send({ message: "unauthorized access" });
  }
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

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

    // jwt token related apis
    app.post("/jwt", async (req, res) => {
      const { email, token: firebaseToken } = req.body;

      if (!email || !firebaseToken) {
        return res
          .status(400)
          .send({ message: "Missing email or Firebase token" });
      }

      try {
        //  Verify Firebase ID token
        const decoded = await admin.auth().verifyIdToken(firebaseToken);

        if (decoded.email !== email) {
          return res
            .status(401)
            .send({ message: "Invalid token or email mismatch" });
        }

        //  Create own server-side JWT
        const accessToken = jwt.sign({ email }, process.env.JWT_ACCESS_SECRET, {
          expiresIn: "30d",
        });

        res.cookie("token", accessToken, {
          httpOnly: true,
          secure: true,
          sameSite: "None",
        });

        console.log("✅ JWT token sent via cookie");
        res.send({ success: true });
      } catch (err) {
        console.error("Firebase token verification failed", err);
        res.status(401).send({ message: "Invalid Firebase token" });
      }
    });

    // users api

    app.get("/users", async (req, res) => {
      const result = await coursionUserCollection.find().toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const newUser = req.body;
      const result = await coursionUserCollection.insertOne(newUser);
      res.send(result);
    });

    // banners api
    app.get("/banners", async (req, res) => {
      const result = await coursionBannerCollection.find().toArray();
      res.send(result);
    });

    // courses api
    app.get("/courses", async (req, res) => {
      const authHeader = req.headers.authorization;
      let email;

      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];

        try {
          const decoded = await admin.auth().verifyIdToken(token);
          email = decoded.email;
        } catch (err) {
          console.log("Invalid token. Serving public courses instead.");
        }
      }

      try {
        const query = email ? { email } : {};
        const result = await coursionCoursesCollection.find(query).toArray();
        res.send(result);
      } catch (err) {
        console.error("Error fetching courses", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/courses/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await coursionCoursesCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!result) {
          return res.status(404).send({ message: "Course not found" });
        }
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Invalid ID format or server error" });
      }
    });

    app.post("/courses", async (req, res) => {
      const newCourse = req.body;
      const result = await coursionCoursesCollection.insertOne(newCourse);
      res.send(result);
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

    app.get(
      "/enrollments/byUser/:email",
      verifyFirebaseToken,
      async (req, res) => {
        const email = req.params.email;

        if (email !== req.decoded.email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const enrollments = await coursionEnrollmentCollection
          .find({ email })
          .toArray();
        res.send(enrollments);
      }
    );

    app.post("/enrollments", async (req, res) => {
      const { email, courseId } = req.body;

      const alreadyEnrolled = await coursionEnrollmentCollection.findOne({
        email,
        courseId,
      });
      if (alreadyEnrolled) {
        return res.status(400).send({ message: "Already enrolled" });
      }

      //  Count user’s active enrollments
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
      const result = await coursionTestimonialCollection.find().toArray();
      res.send(result);
    });

    app.post("/reviews", async (req, res) => {
      const newReview = req.body;
      const result = await coursionTestimonialCollection.insertOne(newReview);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  console.log("GET / route hit");
  res.send("Coursion is cooking");
});

app.listen(port, () => {
  console.log(`Coursion is running on port ${port}`);
});
