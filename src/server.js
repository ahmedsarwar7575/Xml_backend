require("dotenv").config();
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const db = require("./db/init");
const xmls = require("../Xml/xml");
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/feeds", require("./routes/feeds"));
app.use("/api/campaigns", require("./routes/campaigns"));
app.use("/api/proxies", require("./routes/proxies"));
app.use("/api/clicks", require("./routes/clicks"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api/auth", require("./routes/auth"));
app.get("/data.xml", xmls);
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  console.log("Closing database connection...");
  db.close();
  process.exit(0);
});
