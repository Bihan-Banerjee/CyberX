import express from "express";
import cors from "cors";
import scanRouter from "./routes/scan";

const app = express();
const PORT = process.env.PORT || 8787;

// ✅ Enable CORS for all origins (dev-friendly)
app.use(cors({ origin: "http://localhost:5173" }));

// ✅ Parse JSON requests
app.use(express.json());

// ✅ Routes
app.use("/api/scan", scanRouter);

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
