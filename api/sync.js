const { neon } = require('@neondatabase/serverless');

let schemaInitialized = false;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getSql() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) {
    throw new Error('Missing DATABASE_URL environment variable for FlashCard_database');
  }
  return neon(dbUrl);
}

async function ensureSchema(sql) {
  if (schemaInitialized) return;

  await sql`
    CREATE TABLE IF NOT EXISTS et_users (
      email TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      popup_enabled BOOLEAN DEFAULT FALSE,
      popup_interval_minutes INTEGER DEFAULT 5,
      practice_direction TEXT DEFAULT 'mixed',
      updated_at BIGINT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS et_flashcards (
      id TEXT NOT NULL,
      user_email TEXT NOT NULL REFERENCES et_users(email) ON DELETE CASCADE,
      english TEXT NOT NULL,
      vietnamese TEXT NOT NULL,
      phonetic TEXT DEFAULT '',
      part_of_speech TEXT DEFAULT '',
      audio_url TEXT DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_email, id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_et_flashcards_email
    ON et_flashcards(user_email, created_at DESC)
  `;

  schemaInitialized = true;
}

async function readUserFromPostgres(sql, email) {
  await ensureSchema(sql);

  const users = await sql`
    SELECT email, display_name, popup_enabled, popup_interval_minutes, practice_direction, updated_at
    FROM et_users
    WHERE email = ${email}
    LIMIT 1
  `;

  const cards = await sql`
    SELECT id, english, vietnamese, phonetic, part_of_speech, audio_url, created_at, updated_at
    FROM et_flashcards
    WHERE user_email = ${email}
    ORDER BY created_at DESC
  `;

  const flashcards = cards.map(row => ({
    id: row.id,
    english: row.english,
    vietnamese: row.vietnamese,
    phonetic: row.phonetic || '',
    partOfSpeech: row.part_of_speech || '',
    audioUrl: row.audio_url || '',
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now()
  }));

  if (users.length === 0) {
    const defaultName = email.split('@')[0];
    const now = Date.now();
    await sql`
      INSERT INTO et_users (email, display_name, popup_enabled, popup_interval_minutes, practice_direction, updated_at)
      VALUES (${email}, ${defaultName}, FALSE, 5, 'mixed', ${now})
      ON CONFLICT (email) DO NOTHING
    `;
    return {
      email,
      displayName: defaultName,
      flashcards: [],
      settings: {
        popupEnabled: false,
        popupIntervalMinutes: 5,
        practiceDirection: 'mixed'
      },
      updatedAt: now
    };
  }

  const u = users[0];
  return {
    email: u.email,
    displayName: u.display_name || email.split('@')[0],
    flashcards,
    settings: {
      popupEnabled: Boolean(u.popup_enabled),
      popupIntervalMinutes: Number(u.popup_interval_minutes) || 5,
      practiceDirection: u.practice_direction || 'mixed'
    },
    updatedAt: Number(u.updated_at) || Date.now()
  };
}

async function writeUserToPostgres(sql, email, body) {
  await ensureSchema(sql);

  const existing = await readUserFromPostgres(sql, email);
  const now = Date.now();

  const displayName =
    typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim()
      : existing.displayName || email.split('@')[0];

  const settings = {
    ...existing.settings,
    ...(body.settings || {})
  };

  const popupEnabled = Boolean(settings.popupEnabled);
  const popupIntervalMinutes = Math.max(1, Number(settings.popupIntervalMinutes) || 5);
  const practiceDirection = settings.practiceDirection || 'mixed';

  // Upsert user profile in et_users
  await sql`
    INSERT INTO et_users (email, display_name, popup_enabled, popup_interval_minutes, practice_direction, updated_at)
    VALUES (${email}, ${displayName}, ${popupEnabled}, ${popupIntervalMinutes}, ${practiceDirection}, ${now})
    ON CONFLICT (email) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      popup_enabled = EXCLUDED.popup_enabled,
      popup_interval_minutes = EXCLUDED.popup_interval_minutes,
      practice_direction = EXCLUDED.practice_direction,
      updated_at = EXCLUDED.updated_at
  `;

  if (Array.isArray(body.flashcards)) {
    const replaceAll = Boolean(body.replaceAll);
    const incoming = body.flashcards.filter(c => c && c.id && c.english && c.vietnamese);

    if (replaceAll) {
      const incomingIds = incoming.map(c => String(c.id));
      if (incomingIds.length === 0) {
        await sql`DELETE FROM et_flashcards WHERE user_email = ${email}`;
      } else {
        await sql`
          DELETE FROM et_flashcards
          WHERE user_email = ${email}
            AND NOT (id = ANY(${incomingIds}))
        `;
      }
    }

    for (const c of incoming) {
      const cardId = String(c.id);
      const english = String(c.english).normalize('NFC').trim();
      const vietnamese = String(c.vietnamese).normalize('NFC').trim();
      const phonetic = String(c.phonetic || '').normalize('NFC').trim();
      const partOfSpeech = String(c.partOfSpeech || '').trim();
      const audioUrl = String(c.audioUrl || '').trim();
      const createdAt = Number(c.createdAt) || now;
      const updatedAt = Number(c.updatedAt) || now;

      await sql`
        INSERT INTO et_flashcards (
          id, user_email, english, vietnamese, phonetic, part_of_speech, audio_url, created_at, updated_at
        )
        VALUES (
          ${cardId}, ${email}, ${english}, ${vietnamese}, ${phonetic}, ${partOfSpeech}, ${audioUrl}, ${createdAt}, ${updatedAt}
        )
        ON CONFLICT (user_email, id) DO UPDATE SET
          english = EXCLUDED.english,
          vietnamese = EXCLUDED.vietnamese,
          phonetic = EXCLUDED.phonetic,
          part_of_speech = EXCLUDED.part_of_speech,
          audio_url = EXCLUDED.audio_url,
          updated_at = EXCLUDED.updated_at
        WHERE et_flashcards.updated_at <= EXCLUDED.updated_at
      `;
    }
  }

  return await readUserFromPostgres(sql, email);
}

module.exports = async function handler(req, res) {
  // Set CORS headers for Chrome/Edge Extension access
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const sql = getSql();

    if (req.method === 'GET') {
      const email = normalizeEmail(req.query.email);
      if (!email) {
        return res.status(400).json({
          ok: false,
          error: 'Missing email query parameter (e.g. ?email=example@gmail.com)'
        });
      }

      const data = await readUserFromPostgres(sql, email);
      return res.status(200).json({
        ok: true,
        database: 'FlashCard_database (Neon PostgreSQL)',
        data
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const email = normalizeEmail(body.email);

      if (!email) {
        return res.status(400).json({
          ok: false,
          error: 'Email (Gmail) is required to sync data.'
        });
      }

      const updatedData = await writeUserToPostgres(sql, email, body);
      return res.status(200).json({
        ok: true,
        database: 'FlashCard_database (Neon PostgreSQL)',
        data: updatedData
      });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Database API Error:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Internal Server Error'
    });
  }
};
