const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));
app.use(cors());

// ===== MYSQL CONNECTION =====
const db = mysql.createPool({
  host: "shinkansen.proxy.rlwy.net",
  user: "root",
  password: "htatjlGojlWQORRautHzAoHCyoNDkbeG",
  database: "railway",
  port: 45383,
  waitForConnections: true,
  connectionLimit: 10,
});

console.log("✅ MySQL pool created");

// ===== LOGGING =====
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ===== ROOT =====
app.get("/", (req, res) => {
  res.send("✅ Server running");
});

// ===== LOGIN =====
app.post("/login", async (req, res) => {
  const { phone, pin } = req.body;

  if (!phone || !pin) {
    return res.status(400).json({ error: "Phone and PIN required" });
  }

  const normalizedPhone = phone.slice(-9);

  try {
    const [rows] = await db.promise().query(
      "SELECT * FROM members WHERE RIGHT(phone,9)=?",
      [normalizedPhone]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const member = rows[0];

    let valid = false;

    // if stored pin is hashed
    if (member.pin.startsWith("$2")) {
      valid = await bcrypt.compare(pin.toString(), member.pin);
    } 
    // if stored pin is plain
    else {
      valid = pin.toString() === member.pin.toString();
    }

    if (!valid) {
      return res.status(401).json({ error: "Invalid PIN" });
    }

    res.json({
      member_id: member.id,
      name: member.full_name,
      is_admin: member.is_admin
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===== GET ALL MEMBERS =====
app.get("/all-members", async (req, res) => {
  try {
    const [members] = await db.promise().query(`
      SELECT id, full_name, phone, is_admin
      FROM members
      ORDER BY id ASC
    `);

    for (let m of members) {
      try {
        const [contribs] = await db.promise().query(
          `SELECT id, amount, payment_method, created_at, status
           FROM contributions
           WHERE member_id = ?
           ORDER BY created_at DESC`,
          [m.id]
        );

        m.contributions = contribs;
      } catch (e) {
        console.log("⚠ contributions table missing or error");
        m.contributions = [];
      }
    }

    res.json(members);
  } catch (err) {
    console.error("Members fetch error:", err);
    res.status(500).json({ error: "Failed to fetch members" });
  }
});

// ===== ADD MEMBER =====
app.post("/add-member", async (req, res) => {
  const { full_name, phone, pin, is_admin } = req.body;

  try {
    const hashedPin = await bcrypt.hash(pin || "0000", 10);

    await db.promise().query(
      `INSERT INTO members (full_name, phone, pin, approved, is_admin)
       VALUES (?,?,?,?,?)`,
      [full_name, phone, hashedPin, 1, is_admin ? 1 : 0]
    );

    res.json({ message: "Member added" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== UPDATE MEMBER =====
app.put("/update-member/:id", async (req, res) => {
  const { full_name, phone, is_admin } = req.body;

  try {
    await db.promise().query(
      `UPDATE members
       SET full_name=?, phone=?, is_admin=?
       WHERE id=?`,
      [full_name, phone, is_admin ? 1 : 0, req.params.id]
    );

    res.json({ message: "Member updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== DELETE MEMBER =====
app.delete("/delete-member/:id", async (req, res) => {
  try {
    await db.promise().query(
      "DELETE FROM members WHERE id=?",
      [req.params.id]
    );

    res.json({ message: "Member deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== CONTRIBUTION APPROVAL =====
app.post("/approve-contribution/:id", async (req, res) => {
  const { status } = req.body;

  try {
    await db.promise().query(
      "UPDATE contributions SET status=? WHERE id=?",
      [status, req.params.id]
    );

    res.json({ message: "Contribution updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== ANNOUNCEMENTS =====
app.get("/announcements", async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      "SELECT * FROM announcements ORDER BY id DESC"
    );
    res.json(rows);
  } catch (err) {
    res.json([]);
  }
});

// ===== HEALTH CONTENT =====
app.get("/health-contents", async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      "SELECT * FROM health_contents ORDER BY id DESC"
    );
    res.json(rows);
  } catch (err) {
    res.json([]);
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});