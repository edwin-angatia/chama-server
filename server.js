// server.js
const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const cors = require("cors");
const url = require("url");

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));
app.use(cors());

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// MySQL connection
const dbUrl = process.env.DATABASE_URL ||
  "mysql://root:htatjlGojlWQORRautHzAoHCyoNDkbeG@shinkansen.proxy.rlwy.net:45383/railway";

const params = url.parse(dbUrl);
const [user, password] = params.auth.split(":");
const host = params.hostname;
const database = params.path.replace("/", "");
const port = params.port;

const db = mysql.createConnection({ host, user, password, database, port });

db.connect(err => {
  if (err) {
    console.error("❌ MySQL connection error:", err);
    process.exit(1);
  }
  console.log("✅ Connected to MySQL (Railway Public)");
});

// ===== LOGIN =====
app.post("/login", (req, res) => {
  const { phone, pin } = req.body;
  if (!phone || !pin) return res.status(400).json({ error: "Phone and PIN required" });
  db.query("SELECT * FROM members WHERE phone = ?", [phone], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!results.length) return res.status(404).json({ error: "User not found" });

    const member = results[0];
    const valid = pin.toString() === member.pin.toString();
    if (!valid) return res.status(401).json({ error: "Invalid PIN" });

    res.json({ member_id: member.id, name: member.full_name, is_admin: member.is_admin });
  });
});

// ===== MEMBER MANAGEMENT =====
// Add member
app.post("/admin/add-member", (req, res) => {
  const { full_name, phone, pin, is_admin } = req.body;
  if (!full_name || !phone || !pin) return res.status(400).json({ error: "Missing fields" });
  db.query(
    "INSERT INTO members (full_name, phone, pin, is_admin) VALUES (?, ?, ?, ?)",
    [full_name, phone, pin, is_admin ? 1 : 0],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Member added successfully", member_id: result.insertId });
    }
  );
});

// Edit member (already present as /update-member/:id)

// Delete member
app.delete("/admin/delete-member/:id", (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM members WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Member deleted successfully" });
  });
});

// Assign/remove admin
app.put("/admin/set-admin/:id", (req, res) => {
  const { is_admin } = req.body;
  db.query("UPDATE members SET is_admin = ? WHERE id = ?", [is_admin ? 1 : 0, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: `Member ${is_admin ? "granted" : "revoked"} admin rights` });
  });
});

// Approve/reject member (already present as /admin/approve-member/:id)
app.put("/admin/reject-member/:id", (req, res) => {
  db.query("UPDATE members SET approved = FALSE WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Member rejected" });
  });
});

// ===== CONTRIBUTION APPROVAL =====
// Already present as /approve-contribution/:id

// ===== ANNOUNCEMENTS =====
app.get("/announcements", (req, res) => {
  db.query("SELECT * FROM announcements ORDER BY id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/admin/add-announcement", (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: "Missing fields" });
  db.query("INSERT INTO announcements (title, content) VALUES (?, ?)", [title, content], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Announcement added", id: result.insertId });
  });
});

app.put("/admin/edit-announcement/:id", (req, res) => {
  const { title, content } = req.body;
  db.query("UPDATE announcements SET title = ?, content = ? WHERE id = ?", [title, content, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Announcement updated" });
  });
});

app.delete("/admin/delete-announcement/:id", (req, res) => {
  db.query("DELETE FROM announcements WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Announcement deleted" });
  });
});

// ===== HEALTH PAGE CONTENT =====
app.get("/health-contents", (req, res) => {
  db.query("SELECT * FROM health_contents ORDER BY id ASC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/admin/add-health-content", (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: "Missing fields" });
  db.query("INSERT INTO health_contents (title, content) VALUES (?, ?)", [title, content], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Health content added", id: result.insertId });
  });
});

app.put("/admin/edit-health-content/:id", (req, res) => {
  const { title, content } = req.body;
  db.query("UPDATE health_contents SET title = ?, content = ? WHERE id = ?", [title, content, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Health content updated" });
  });
});

app.delete("/admin/delete-health-content/:id", (req, res) => {
  db.query("DELETE FROM health_contents WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Health content deleted" });
  });
});

// ===== ROOT =====
app.get("/", (req, res) => res.send("API is running..."));

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server running on port ${PORT}`));