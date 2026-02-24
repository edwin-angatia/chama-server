// server.js
const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const cors = require("cors");

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));
app.use(cors());

// ===== Logging middleware =====
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ===== MySQL connection =====
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "Mombasa",
  database: "chama_app"
});

db.connect(err => {
  if (err) {
    console.error("❌ MySQL connection error:", err.message);
    process.exit(1);
  }
  console.log("✅ MySQL connected");
});

// ===== LOGIN =====
app.post("/login", (req, res) => {
  const { phone, pin } = req.body;

  db.query("SELECT * FROM members WHERE phone = ?", [phone], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!results.length) return res.status(404).json({ error: "User not found" });

    const member = results[0];
    const valid = bcrypt.compareSync(pin, member.pin);

    if (!valid) return res.status(401).json({ error: "Invalid PIN" });

    res.json({
      member_id: member.id,
      name: member.full_name,
      is_admin: member.is_admin
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

      db.query(
        "SELECT * FROM contributions WHERE member_id = ? ORDER BY created_at DESC",
        [memberId],
        (err3, contribRes) => {
          if (err3) return res.status(500).json({ error: err3.message });

          const total = contribRes.reduce(
            (sum, c) => sum + parseFloat(c.amount),
            0
          );

          res.json({
            member,
            chama,
            total_contributions: total.toFixed(2),
            history: contribRes
          });
        }
      );
    });
  });
});

// ===== UPDATE MEMBER =====
app.put("/update-member/:id", (req, res) => {
  const { full_name, phone, photo_url } = req.body;
  db.query(
    "UPDATE members SET full_name = ?, phone = ?, photo_url = ? WHERE id = ?",
    [full_name, phone, photo_url, req.params.id],
    (err) => {
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

      // Group contributions under each member
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
  const { status } = req.body; // "confirmed" or "rejected"
  db.query(
    "UPDATE contributions SET status = ? WHERE id = ?",
    [status, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Contribution updated successfully" });
    }
  );
});

// ===== IT SUPPORT =====
app.get("/it-support", (req, res) => {
  const phone = "254788488881";
  const message = encodeURIComponent("Hello IT, I need your assistance");
  res.json({ whatsapp_url: `https://wa.me/${phone}?text=${message}` });
});

// ===== ROOT =====
app.get("/", (req, res) => res.send("API is running..."));

// ===== START SERVER =====
app.listen(3000, "0.0.0.0", () => console.log("✅ Server running on port 3000"));