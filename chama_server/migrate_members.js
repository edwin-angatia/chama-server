// migrate_members_final.js
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");

async function migrate() {
  // Local DB (Workbench)
  const localDb = await mysql.createConnection({
    host: "localhost",
    user: "migrate",
    password: "mypass123", // <-- replace
    database: "chama_app"
  });

  // Remote DB (Railway)
  const remoteDb = await mysql.createConnection({
    host: "shinkansen.proxy.rlwy.net",
    user: "root",
    password: "htatjlGojlWQORRautHzAoHCyoNDkbeG",
    database: "railway",
    port: 45383
  });

  const [members] = await localDb.execute(
    "SELECT full_name, phone, pin, is_admin FROM members"
  );

  console.log(`Found ${members.length} members locally.`);

  for (const member of members) {
    if (!member.pin) {
      console.log(`⚠ Skipping ${member.full_name} (${member.phone}) — empty PIN`);
      continue;
    }

    const hashedPin = await bcrypt.hash(member.pin, 10);

    try {
      await remoteDb.execute(
        "INSERT INTO members (full_name, phone, pin, is_admin) VALUES (?, ?, ?, ?)",
        [member.full_name, member.phone, hashedPin, member.is_admin || 0]
      );
      console.log(`✅ Migrated: ${member.full_name} (${member.phone})`);
    } catch (err) {
      console.log(`❌ Error migrating ${member.full_name}:`, err.message);
    }
  }

  console.log("Migration complete ✅");
  await localDb.end();
  await remoteDb.end();
}

migrate();