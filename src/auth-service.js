const crypto = require("node:crypto");

const sessionDuration = 7 * 24 * 60 * 60 * 1000;
const resetDuration = 10 * 60 * 1000;

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function validPassword(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 128 &&
    /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password) &&
    /[^A-Za-z0-9\s]/.test(password);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function passwordMatches(password, stored) {
  if (typeof stored !== "string") return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!/^[a-f0-9]{32}$/i.test(saltHex || "") || !/^[a-f0-9]{128}$/i.test(hashHex || "")) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(actual, expected);
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function createAuthService(database) {
  const statements = {
    findByEmail: database.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE"),
    findById: database.prepare("SELECT id, name, email, role, is_active AS isActive FROM users WHERE id = ?"),
    createUser: database.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)"),
    updatePassword: database.prepare("UPDATE users SET password_hash = ? WHERE email = ?"),
    updateActive: database.prepare("UPDATE users SET is_active = ? WHERE id = ? AND role != 'admin'"),
    allUsers: database.prepare("SELECT id, name, email, role, is_active AS isActive, created_at AS createdAt FROM users ORDER BY created_at DESC"),
    insertSession: database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"),
    sessionUser: database.prepare(`
      SELECT users.id, users.name, users.email, users.role
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.is_active = 1
    `),
    deleteSession: database.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    deleteExpiredSessions: database.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
    deleteUserSessions: database.prepare("DELETE FROM sessions WHERE user_id = ?"),
    insertReset: database.prepare(`
      INSERT INTO password_resets (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
      ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0
    `),
    getReset: database.prepare("SELECT code_hash AS codeHash, expires_at AS expiresAt, attempts FROM password_resets WHERE email = ?"),
    incrementReset: database.prepare("UPDATE password_resets SET attempts = attempts + 1 WHERE email = ?"),
    deleteReset: database.prepare("DELETE FROM password_resets WHERE email = ?")
  };

  return {
    seedAdmin(emailInput, password) {
      const email = normalizeEmail(emailInput);
      if (!email && !password) return;
      if (!validEmail(email) || typeof password !== "string" || password.length < 8 || password.length > 128) {
        throw new Error("Set a valid ADMIN_EMAIL and an ADMIN_PASSWORD between 8 and 128 characters.");
      }
      const existing = statements.findByEmail.get(email);
      if (existing) {
        if (existing.role !== "admin") {
          throw new Error("ADMIN_EMAIL is already registered as a non-admin account; refusing to elevate it.");
        }
        return;
      }
      statements.createUser.run("MANGAN Administrator", email, hashPassword(password), "admin");
      console.log("Seeded the configured MANGAN administrator account.");
    },
    register({ name, email: emailInput, password, role }) {
      const normalizedName = typeof name === "string" ? name.trim() : "";
      const email = normalizeEmail(emailInput);
      if (!normalizedName || normalizedName.length > 100) {
        throw new AuthError(400, "Enter a name between 1 and 100 characters.");
      }
      if (!validEmail(email)) throw new AuthError(400, "Enter a valid email address.");
      if (!validPassword(password)) {
        throw new AuthError(400, "Use 8–128 characters with an uppercase letter, lowercase letter, number, and symbol.");
      }
      if (!["user", "owner"].includes(role)) {
        throw new AuthError(400, "Choose a customer or restaurant owner account.");
      }
      if (statements.findByEmail.get(email)) throw new AuthError(409, "An account already uses that email.");
      const result = statements.createUser.run(normalizedName, email, hashPassword(password), role);
      return safeUser(statements.findById.get(Number(result.lastInsertRowid)));
    },
    login({ email: emailInput, password }) {
      const email = normalizeEmail(emailInput);
      const user = statements.findByEmail.get(email);
      if (!user || typeof password !== "string" || !passwordMatches(password, user.password_hash)) {
        throw new AuthError(401, "Email or password is incorrect.");
      }
      if (!user.is_active) throw new AuthError(403, "This account is disabled. Contact the MANGAN administrator.");
      return safeUser(user);
    },
    issueSession(userId) {
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + sessionDuration;
      statements.insertSession.run(digest(token), userId, expiresAt);
      return { token, expiresAt };
    },
    userForSession(token) {
      if (typeof token !== "string" || token.length < 40) return null;
      statements.deleteExpiredSessions.run(Date.now());
      const user = statements.sessionUser.get(digest(token), Date.now());
      return user ? safeUser(user) : null;
    },
    revokeSession(token) {
      if (typeof token === "string" && token.length >= 40) statements.deleteSession.run(digest(token));
    },
    requestPasswordReset(emailInput) {
      const email = normalizeEmail(emailInput);
      const user = statements.findByEmail.get(email);
      if (!user || !user.is_active) return null;
      const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
      statements.insertReset.run(email, digest(code), Date.now() + resetDuration);
      return code;
    },
    resetPassword({ email: emailInput, code, password }) {
      const email = normalizeEmail(emailInput);
      const record = statements.getReset.get(email);
      if (!record || record.expiresAt <= Date.now() || record.attempts >= 5) {
        statements.deleteReset.run(email);
        throw new AuthError(400, "That reset code expired or is locked. Request a new code.");
      }
      const codeHash = typeof code === "string" && /^\d{6}$/.test(code) ? digest(code) : digest("invalid");
      const match = crypto.timingSafeEqual(Buffer.from(codeHash, "hex"), Buffer.from(record.codeHash, "hex"));
      if (!match) {
        statements.incrementReset.run(email);
        throw new AuthError(400, "That reset code is incorrect.");
      }
      if (!validPassword(password)) {
        throw new AuthError(400, "Use 8–128 characters with an uppercase letter, lowercase letter, number, and symbol.");
      }
      statements.updatePassword.run(hashPassword(password), email);
      statements.deleteUserSessions.run(statements.findByEmail.get(email).id);
      statements.deleteReset.run(email);
    },
    listUsers() {
      return statements.allUsers.all().map((user) => ({ ...user, isActive: Boolean(user.isActive) }));
    },
    setUserActive(userId, isActive) {
      return statements.updateActive.run(Number(isActive), userId).changes > 0;
    }
  };
}

module.exports = { AuthError, createAuthService, normalizeEmail };
