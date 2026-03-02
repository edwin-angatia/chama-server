// server.js
const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const cors = require("cors");
const url = require("url");

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));
app.use(cors());

// ===== Logging middleware =====
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ===== MySQL connection using DATABASE_URL =====
const dbUrl = process.env.DATABASE_URL || 
  "mysql://root:htatjlGojlWQORRautHzAoHCyoNDkbeG@shinkansen.proxy.rlwy.net:45383/railway";

if (!dbUrl) {
  console.error("❌ DATABASE_URL not set!");
  process.exit(1);
}

// Parse the DATABASE_URL
const params = url.parse(dbUrl);
const [user, password] = params.auth.split(":");
const host = params.hostname;
const database = params.path.replace("/", "");
const port = params.port;

const db = mysql.createConnection({
  host,
  user,
  password,
  database,
  port
});

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

    res.json({
      member_id: member.id,
      name: member.full_name,
      is_admin: member.is_admin
    });
  });
});

// ===== BIOMETRIC LOGIN =====
app.post("/biometric-login", (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone is required" });

  db.query("SELECT * FROM members WHERE phone = ?", [phone], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!results.length) return res.status(404).json({ error: "Member not found" });

    const member = results[0];
    if (member.biometric_enabled !== 1) {
      return res.status(403).json({ error: "Biometric login not enabled" });
    }

    res.json(member);
  });
});

// ===== CHANGE PIN =====
app.post("/change-pin", (req, res) => {
  const { member_id, old_pin, new_pin } = req.body;
  if (!member_id || !old_pin || !new_pin) return res.status(400).json({ error: "Missing fields" });

  db.query("SELECT * FROM members WHERE id = ? AND pin = ?", [member_id, old_pin], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!results.length) return res.status(401).json({ error: "Old PIN incorrect" });

    db.query("UPDATE members SET pin = ? WHERE id = ?", [new_pin, member_id], err2 => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ message: "PIN updated successfully" });
    });
  });
});

// ===== MEMBER DASHBOARD =====
app.get("/member-dashboard/:id", (req, res) => {
  const memberId = req.params.id;

  db.query("SELECT * FROM members WHERE id = ?", [memberId], (err, memberRes) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!memberRes.length) return res.status(404).json({ error: "User not found" });

    const member = memberRes[0];

    db.query("SELECT * FROM chama LIMIT 1", (err2, chamaRes) => {
      if (err2) return res.status(500).json({ error: err2.message });
      const chama = chamaRes[0];

      db.query("SELECT * FROM contributions WHERE member_id = ? ORDER BY created_at DESC", [memberId], (err3, contribRes) => {
        if (err3) return res.status(500).json({ error: err3.message });

        const total = contribRes.reduce((sum, c) => sum + parseFloat(c.amount), 0);

        res.json({
          member,
          chama,
          total_contributions: total.toFixed(2),
          history: contribRes
        });
      });
    });
  });
});

// ===== UPDATE MEMBER =====
app.put("/update-member/:id", (req, res) => {
  const { full_name, phone, photo_url } = req.body;
  db.query(
    "UPDATE members SET full_name = ?, phone = ?, photo_url = ? WHERE id = ?",
    [full_name, phone, photo_url, req.params.id],
    err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Profile updated successfully" });
    }
  );
});

// ===== GET ALL MEMBERS (ADMIN) =====
app.get("/all-members", (req, res) => {
  db.query(
    `SELECT m.id, m.full_name, m.phone, m.is_admin, m.photo_url, 
            c.id AS contribution_id, c.amount, c.status, c.payment_method, c.created_at
     FROM members m
     LEFT JOIN contributions c ON m.id = c.member_id
     ORDER BY m.id, c.created_at DESC`,
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      const members = {};
      results.forEach(r => {
        if (!members[r.id]) {
          members[r.id] = {
            id: r.id,
            full_name: r.full_name,
            phone: r.phone,
            is_admin: r.is_admin,
            photo_url: r.photo_url,
            contributions: []
          };
        }
        if (r.contribution_id) {
          members[r.id].contributions.push({
            id: r.contribution_id,
            amount: r.amount,
            status: r.status,
            payment_method: r.payment_method,
            created_at: r.created_at
          });
        }
      });

      res.json(Object.values(members));
    }
  );
});

// ===== APPROVE / REJECT CONTRIBUTION =====
app.post("/approve-contribution/:id", (req, res) => {
  const { status } = req.body;
  db.query("UPDATE contributions SET status = ? WHERE id = ?", [status, req.params.id], err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Contribution updated successfully" });
  });
});

// ===== IT SUPPORT =====
app.get("/it-support", (req, res) => {
  const phone = "254788488881";
  const message = encodeURIComponent("Assalaamu Aleykum!");
  res.json({ whatsapp_url: `https://wa.me/${phone}?text=${message}` });
});

// ===== ROOT =====
app.get("/", (req, res) => res.send("API is running..."));

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server running on port ${PORT}`));