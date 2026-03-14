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
  if (!phone || !pin) return res.status(400).json({ error: "Phone and PIN required" });

  const normalizedPhone = phone.slice(-9);

  try {
    const [rows] = await db.promise().query(
      "SELECT * FROM members WHERE RIGHT(phone,9)=?",
      [normalizedPhone]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    const member = rows[0];
    let valid = false;

    if (member.pin.startsWith("$2")) {
      valid = await bcrypt.compare(pin.toString(), member.pin);
    } else {
      valid = pin.toString() === member.pin.toString();
    }

    if (!valid) return res.status(401).json({ error: "Invalid PIN" });

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

// ===== GET ALL MEMBERS (with contributions) =====
app.get("/all-members", async (req, res) => {
  try {
    const [members] = await db.promise().query(`
      SELECT id, full_name, phone, is_admin
      FROM members
      ORDER BY id ASC
    `);

    for (let m of members) {
      const [contribs] = await db.promise().query(
        `SELECT id, amount, contribution_type, payment_method, created_at, status
         FROM contributions
         WHERE member_id = ?
         ORDER BY created_at DESC`,
        [m.id]
      );
      m.contributions = contribs;
      
      const [totals] = await db.promise().query(`
        SELECT 
          SUM(CASE WHEN contribution_type='monthly' AND status='approved' THEN amount ELSE 0 END) AS monthly_total,
          SUM(CASE WHEN contribution_type='emergency' AND status='approved' THEN amount ELSE 0 END) AS emergency_total
        FROM contributions
        WHERE member_id=?
      `, [m.id]);

      m.monthly_total = totals[0].monthly_total || 0;
      m.emergency_total = totals[0].emergency_total || 0;
    }

    res.json(members);

  } catch (err) {
    console.error("Members fetch error:", err);
    res.status(500).json({ error: "Failed to fetch members" });
  }
});

// ===== MEMBER CONTRIBUTIONS (GET) =====
app.get("/member-contributions/:memberId", async (req, res) => {
  const memberId = req.params.memberId;
  
  try {
    // Get all contributions
    const [contributions] = await db.promise().query(
      `SELECT id, amount, contribution_type, payment_method, created_at, status
       FROM contributions
       WHERE member_id = ?
       ORDER BY created_at DESC`,
      [memberId]
    );
    
    // Get monthly contributions list
    const [monthly] = await db.promise().query(
      `SELECT id, amount, created_at
       FROM contributions
       WHERE member_id = ? AND contribution_type = 'monthly' AND status = 'approved'
       ORDER BY created_at ASC`,
      [memberId]
    );
    
    // Get monthly total
    const [monthlyTotal] = await db.promise().query(
      `SELECT IFNULL(SUM(amount),0) AS total
       FROM contributions
       WHERE member_id = ? AND contribution_type = 'monthly' AND status = 'approved'`,
      [memberId]
    );
    
    // Get emergency total
    const [emergencyTotal] = await db.promise().query(
      `SELECT IFNULL(SUM(amount),0) AS total
       FROM contributions
       WHERE member_id = ? AND contribution_type = 'emergency' AND status = 'approved'`,
      [memberId]
    );
    
    res.json({
      contributions: contributions,
      monthly_contributions: monthly,
      monthly_total: monthlyTotal[0].total,
      emergency_total: emergencyTotal[0].total
    });
    
  } catch (err) {
    console.error("Member contributions error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== MEMBER DASHBOARD =====
app.get("/member-dashboard/:memberId", async (req, res) => {
  const memberId = req.params.memberId;
  
  try {
    // Get member info
    const [memberRows] = await db.promise().query(
      "SELECT id, full_name, phone, is_admin FROM members WHERE id = ?",
      [memberId]
    );
    
    if (memberRows.length === 0) {
      return res.status(404).json({ error: "Member not found" });
    }
    
    // Get chama info
    let chamaName = "Kwazera Welfare Society";
    try {
      const [chamaRows] = await db.promise().query(
        "SELECT chama_name FROM chama_settings LIMIT 1"
      );
      if (chamaRows.length > 0) {
        chamaName = chamaRows[0].chama_name;
      }
    } catch (e) {
      console.log("Chama settings table not found, using default");
    }
    
    // Get recent history
    const [history] = await db.promise().query(
      `SELECT amount, contribution_type, 
        CONCAT(contribution_type, ' contribution') as description,
        created_at
       FROM contributions
       WHERE member_id = ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [memberId]
    );
    
    res.json({
      member: memberRows[0],
      chama: { chama_name: chamaName },
      history: history
    });
    
  } catch (err) {
    console.error("Member dashboard error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== TOGGLE MONTHLY CONTRIBUTION (ADD/REMOVE) =====
app.post("/toggle-monthly", async (req, res) => {
  const { member_id, month, action } = req.body;
  if (!member_id || !month || !action) {
    return res.status(400).json({ error: "member_id, month, and action required" });
  }

  try {
    // Parse month (format: "2026-01")
    const [year, monthNum] = month.split('-');
    
    if (action === "add") {
      // Check if already exists for this month
      const [existing] = await db.promise().query(
        `SELECT id FROM contributions 
         WHERE member_id = ? 
         AND contribution_type = 'monthly' 
         AND YEAR(created_at) = ? 
         AND MONTH(created_at) = ?`,
        [member_id, year, monthNum]
      );
      
      if (existing.length > 0) {
        return res.json({ message: "Monthly contribution already exists for this month" });
      }
      
      // Add monthly contribution (15th of the month)
      const contributionDate = new Date(year, monthNum - 1, 15);
      const transaction_code = `admin-${member_id}-${month}`;
      
      await db.promise().query(
        `INSERT INTO contributions 
         (member_id, amount, contribution_type, transaction_code, payment_method, status, created_at) 
         VALUES (?, ?, 'monthly', ?, 'admin', 'approved', ?)`,
        [member_id, 150, transaction_code, contributionDate]
      );
      
      res.json({ success: true, message: "Monthly contribution added" });
      
    } else if (action === "remove") {
      // Remove monthly contribution for that month
      const [result] = await db.promise().query(
        `DELETE FROM contributions 
         WHERE member_id = ? 
         AND contribution_type = 'monthly' 
         AND YEAR(created_at) = ? 
         AND MONTH(created_at) = ?`,
        [member_id, year, monthNum]
      );
      
      if (result.affectedRows > 0) {
        res.json({ success: true, message: "Monthly contribution removed" });
      } else {
        res.status(404).json({ error: "No monthly contribution found for this month" });
      }
    }
    
  } catch (err) {
    console.error("Toggle monthly error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== UPDATE EMERGENCY CONTRIBUTION (ADD/REMOVE) =====
app.post("/update-emergency", async (req, res) => {
  const { member_id, amount, action } = req.body;
  if (!member_id || !amount || !action) {
    return res.status(400).json({ error: "member_id, amount, and action required" });
  }

  try {
    if (action === "add") {
      // Add emergency contribution
      const transaction_code = `admin-emergency-${Date.now()}`;
      
      await db.promise().query(
        `INSERT INTO contributions 
         (member_id, amount, contribution_type, transaction_code, payment_method, status, created_at) 
         VALUES (?, ?, 'emergency', ?, 'admin', 'approved', NOW())`,
        [member_id, amount, transaction_code]
      );
      
      // Get updated totals
      const [totals] = await db.promise().query(
        `SELECT 
          SUM(CASE WHEN contribution_type='monthly' AND status='approved' THEN amount ELSE 0 END) AS monthly_total,
          SUM(CASE WHEN contribution_type='emergency' AND status='approved' THEN amount ELSE 0 END) AS emergency_total
         FROM contributions
         WHERE member_id=?`,
        [member_id]
      );
      
      res.json({ 
        success: true, 
        message: "Emergency contribution added",
        monthly_total: totals[0].monthly_total || 0,
        emergency_total: totals[0].emergency_total || 0
      });
      
    } else if (action === "remove") {
      // Remove most recent emergency contribution of that amount
      const [result] = await db.promise().query(
        `DELETE FROM contributions 
         WHERE id = (
           SELECT id FROM (
             SELECT id FROM contributions 
             WHERE member_id = ? 
             AND contribution_type = 'emergency' 
             AND amount = ?
             ORDER BY created_at DESC 
             LIMIT 1
           ) AS tmp
         )`,
        [member_id, amount]
      );
      
      if (result.affectedRows > 0) {
        // Get updated totals
        const [totals] = await db.promise().query(
          `SELECT 
            SUM(CASE WHEN contribution_type='monthly' AND status='approved' THEN amount ELSE 0 END) AS monthly_total,
            SUM(CASE WHEN contribution_type='emergency' AND status='approved' THEN amount ELSE 0 END) AS emergency_total
           FROM contributions
           WHERE member_id=?`,
          [member_id]
        );
        
        res.json({ 
          success: true, 
          message: "Emergency contribution removed",
          monthly_total: totals[0].monthly_total || 0,
          emergency_total: totals[0].emergency_total || 0
        });
      } else {
        res.status(404).json({ error: "No matching emergency contribution found" });
      }
    }
    
  } catch (err) {
    console.error("Update emergency error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== MARK MONTHLY CONTRIBUTION (Legacy) =====
app.post("/mark-monthly", async (req, res) => {
  const { member_id, month, amount = 150 } = req.body;
  if (!member_id || !month) return res.status(400).json({ error: "member_id and month required" });

  try {
    const transaction_code = `admin-${member_id}-${month}`;

    const [exists] = await db.promise().query(
      `SELECT id FROM contributions
       WHERE member_id=? 
       AND contribution_type='monthly'
       AND transaction_code=?`,
      [member_id, transaction_code]
    );

    if (exists.length) return res.json({ message: "Monthly contribution already recorded" });

    await db.promise().query(
      `INSERT INTO contributions
       (member_id, amount, contribution_type, transaction_code, payment_method, status, created_at)
       VALUES (?, ?, 'monthly', ?, 'admin', 'approved', NOW())`,
      [member_id, amount, transaction_code]
    );

    res.json({
      success: true,
      message: `Monthly contribution recorded for ${month}`
    });

  } catch (err) {
    console.error("Mark monthly error:", err);
    res.status(500).json({ error: "Failed to mark monthly contribution" });
  }
});

// ===== GENERATE MONTHLY CONTRIBUTIONS FOR ALL MEMBERS =====
app.post("/generate-monthly", async (req, res) => {
  const { month, amount = 150 } = req.body;
  if (!month) return res.status(400).json({ error: "month required" });

  try {
    const [members] = await db.promise().query("SELECT id FROM members");
    let inserted = 0;

    for (const m of members) {
      const transaction_code = `admin-${m.id}-${month}`;
      const [exists] = await db.promise().query(
        `SELECT id FROM contributions
         WHERE member_id=? 
         AND contribution_type='monthly'
         AND transaction_code=?`,
        [m.id, transaction_code]
      );

      if (!exists.length) {
        await db.promise().query(
          `INSERT INTO contributions
          (member_id, amount, contribution_type, transaction_code, payment_method, status, created_at)
          VALUES (?, ?, 'monthly', ?, 'admin', 'approved', NOW())`,
          [m.id, amount, transaction_code]
        );
        inserted++;
      }
    }

    res.json({ success: true, message: `${inserted} monthly contributions created` });

  } catch (err) {
    console.error("Generate monthly error:", err);
    res.status(500).json({ error: "Failed to generate monthly contributions" });
  }
});

// ===== ADD EMERGENCY CONTRIBUTION (Legacy) =====
app.post("/add-emergency", async (req, res) => {
  const { member_id, amount } = req.body;
  if (!member_id || !amount || amount <= 0) return res.status(400).json({ error: "member_id and positive amount required" });

  try {
    const transaction_code = `admin-emergency-${Date.now()}`;

    await db.promise().query(
      `INSERT INTO contributions
       (member_id, amount, contribution_type, transaction_code, payment_method, status, created_at)
       VALUES (?, ?, 'emergency', ?, 'admin', 'approved', NOW())`,
      [member_id, amount, transaction_code]
    );

    // return updated totals
    const [monthly] = await db.promise().query(
      `SELECT IFNULL(SUM(amount),0) AS total
       FROM contributions
       WHERE member_id=? AND contribution_type='monthly' AND status='approved'`,
      [member_id]
    );

    const [emergency] = await db.promise().query(
      `SELECT IFNULL(SUM(amount),0) AS total
       FROM contributions
       WHERE member_id=? AND contribution_type='emergency' AND status='approved'`,
      [member_id]
    );

    res.json({
      success: true,
      monthly_total: monthly[0].total,
      emergency_total: emergency[0].total
    });

  } catch (err) {
    console.error("Add emergency error:", err);
    res.status(500).json({ error: "Failed to add emergency contribution" });
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
    // First delete all contributions for this member
    await db.promise().query("DELETE FROM contributions WHERE member_id=?", [req.params.id]);
    // Then delete the member
    await db.promise().query("DELETE FROM members WHERE id=?", [req.params.id]);
    res.json({ message: "Member and all contributions deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== ANNOUNCEMENTS =====
app.get("/announcements", async (req, res) => {
  try {
    const [rows] = await db.promise().query("SELECT * FROM announcements ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) {
    res.json([]);
  }
});

// ===== LATEST ANNOUNCEMENT =====
app.get("/latest-announcement", async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      "SELECT message FROM announcements ORDER BY created_at DESC LIMIT 1"
    );
    
    if (rows.length > 0) {
      res.json({ message: rows[0].message });
    } else {
      res.json({ message: "Karibuni wanachama." });
    }
  } catch (err) {
    console.error("Latest announcement error:", err);
    res.json({ message: "Karibuni wanachama." });
  }
});

// ===== ALL ANNOUNCEMENTS =====
app.get("/all-announcements", async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      "SELECT * FROM announcements ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("All announcements error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== POST ANNOUNCEMENT =====
app.post("/post-announcement", async (req, res) => {
  const { title, message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }
  
  try {
    const [result] = await db.promise().query(
      "INSERT INTO announcements (title, message, created_at) VALUES (?, ?, NOW())",
      [title || "Announcement", message]
    );
    
    res.json({ 
      success: true, 
      id: result.insertId,
      message: "Announcement posted successfully" 
    });
  } catch (err) {
    console.error("Post announcement error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== DELETE ANNOUNCEMENT =====
app.delete("/delete-announcement/:id", async (req, res) => {
  const id = req.params.id;
  
  try {
    const [result] = await db.promise().query(
      "DELETE FROM announcements WHERE id = ?",
      [id]
    );
    
    if (result.affectedRows > 0) {
      res.json({ success: true, message: "Announcement deleted" });
    } else {
      res.status(404).json({ error: "Announcement not found" });
    }
  } catch (err) {
    console.error("Delete announcement error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== HEALTH CONTENT =====
app.get("/health-contents", async (req, res) => {
  try {
    const [rows] = await db.promise().query("SELECT * FROM health_contents ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    res.json([]);
  }
});

// ===== MEMBERS HTML VIEW =====
app.get("/members-html", async (req, res) => {
  try {
    const [members] = await db.promise().query(`
      SELECT id, full_name, phone, is_admin
      FROM members
      ORDER BY id ASC
    `);

    let html = `<h1>Members</h1><table border="1" cellpadding="5">
                <tr><th>ID</th><th>Name</th><th>Phone</th><th>Admin</th></tr>`;

    for (let m of members) {
      html += `<tr>
                <td>${m.id}</td>
                <td>${m.full_name}</td>
                <td>${m.phone}</td>
                <td>${m.is_admin ? "Yes" : "No"}</td>
               </tr>`;
    }

    html += `</table>`;
    res.send(html);

  } catch (err) {
    res.status(500).send("Failed to load members");
  }
});

// ===== CREATE CHAMA SETTINGS TABLE (if not exists) =====
app.get("/setup", async (req, res) => {
  try {
    // Create chama_settings table
    await db.promise().query(`
      CREATE TABLE IF NOT EXISTS chama_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        chama_name VARCHAR(255) NOT NULL DEFAULT 'Kwazera Welfare Society',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    // Insert default if empty
    const [rows] = await db.promise().query("SELECT * FROM chama_settings");
    if (rows.length === 0) {
      await db.promise().query(
        "INSERT INTO chama_settings (chama_name) VALUES ('Kwazera Welfare Society')"
      );
    }
    
    res.json({ success: true, message: "Setup completed" });
  } catch (err) {
    console.error("Setup error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});