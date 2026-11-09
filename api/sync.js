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

function parseAltMeanings(raw) {
  if (Array.isArray(raw)) {
    return raw.map(s => String(s || '').normalize('NFC').trim()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(s => String(s || '').normalize('NFC').trim()).filter(Boolean);
      }
    } catch (e) {
      // Ignore parse error
    }
  }
  return [];
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
      alt_meanings TEXT DEFAULT '[]',
      phonetic TEXT DEFAULT '',
      part_of_speech TEXT DEFAULT '',
      audio_url TEXT DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_email, id)
    )
  `;

  await sql`
    ALTER TABLE et_flashcards
    ADD COLUMN IF NOT EXISTS alt_meanings TEXT DEFAULT '[]'
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_et_flashcards_email
    ON et_flashcards(user_email, created_at DESC)
  `;

  schemaInitialized = true;
}

async function readUserFromPostgres(sql, email, sinceTimestamp = 0) {
  await ensureSchema(sql);

  const users = await sql`
    SELECT email, display_name, popup_enabled, popup_interval_minutes, practice_direction, updated_at
    FROM et_users
    WHERE email = ${email}
    LIMIT 1
  `;

  if (users.length === 0) {
    const defaultName = email.split('@')[0];
    const now = Date.now();
    await sql`
      INSERT INTO et_users (email, display_name, popup_enabled, popup_interval_minutes, practice_direction, updated_at)
      VALUES (${email}, ${defaultName}, FALSE, 5, 'mixed', ${now})
      ON CONFLICT (email) DO NOTHING
    `;
    return {
      unchanged: false,
      data: {
        email,
        displayName: defaultName,
        flashcards: [],
        settings: {
          popupEnabled: false,
          popupIntervalMinutes: 5,
          practiceDirection: 'mixed'
        },
        updatedAt: now
      }
    };
  }

  const u = users[0];
  const serverUpdatedAt = Number(u.updated_at) || 0;

  if (sinceTimestamp > 0 && serverUpdatedAt > 0 && serverUpdatedAt <= sinceTimestamp) {
    return {
      unchanged: true,
      updatedAt: serverUpdatedAt
    };
  }

  const cards = await sql`
    SELECT id, english, vietnamese, alt_meanings, phonetic, part_of_speech, audio_url, created_at, updated_at
    FROM et_flashcards
    WHERE user_email = ${email}
    ORDER BY created_at DESC
  `;

  const flashcards = cards.map(row => ({
    id: row.id,
    english: String(row.english || '').normalize('NFC'),
    vietnamese: String(row.vietnamese || '').normalize('NFC'),
    altMeanings: parseAltMeanings(row.alt_meanings),
    phonetic: row.phonetic || '',
    partOfSpeech: row.part_of_speech || '',
    audioUrl: row.audio_url || '',
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now()
  }));

  return {
    unchanged: false,
    data: {
      email: u.email,
      displayName: u.display_name || email.split('@')[0],
      flashcards,
      settings: {
        popupEnabled: Boolean(u.popup_enabled),
        popupIntervalMinutes: Number(u.popup_interval_minutes) || 5,
        practiceDirection: u.practice_direction || 'mixed'
      },
      updatedAt: serverUpdatedAt
    }
  };
}

async function writeUserToPostgres(sql, email, body) {
  await ensureSchema(sql);

  const now = Date.now();
  const displayName =
    typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim()
      : email.split('@')[0];

  const settings = body.settings || {};
  const popupEnabled = Boolean(settings.popupEnabled);
  const popupIntervalMinutes = Math.max(1, Number(settings.popupIntervalMinutes) || 5);
  const practiceDirection = settings.practiceDirection || 'mixed';

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

  if (Array.isArray(body.deletedIds) && body.deletedIds.length > 0) {
    const delIds = body.deletedIds.map(id => String(id));
    await sql`
      DELETE FROM et_flashcards
      WHERE user_email = ${email}
        AND id = ANY(${delIds})
    `;
  }

  const cardsToUpsert = Array.isArray(body.upserts)
    ? body.upserts
    : (Array.isArray(body.flashcards) ? body.flashcards : []);

  if (Boolean(body.replaceAll) && Array.isArray(body.flashcards)) {
    const incomingIds = cardsToUpsert.filter(c => c && c.id).map(c => String(c.id));
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

  const validCards = cardsToUpsert.filter(c => c && c.id && c.english && c.vietnamese);
  for (const c of validCards) {
    const cardId = String(c.id);
    const english = String(c.english).normalize('NFC').trim();
    const vietnamese = String(c.vietnamese).normalize('NFC').trim();
    const altMeaningsJson = JSON.stringify(parseAltMeanings(c.altMeanings));
    const phonetic = String(c.phonetic || '').normalize('NFC').trim();
    const partOfSpeech = String(c.partOfSpeech || '').trim();
    const audioUrl = String(c.audioUrl || '').trim();
    const createdAt = Number(c.createdAt) || now;
    const updatedAt = Number(c.updatedAt) || now;

    await sql`
      INSERT INTO et_flashcards (
        id, user_email, english, vietnamese, alt_meanings, phonetic, part_of_speech, audio_url, created_at, updated_at
      )
      VALUES (
        ${cardId}, ${email}, ${english}, ${vietnamese}, ${altMeaningsJson}, ${phonetic}, ${partOfSpeech}, ${audioUrl}, ${createdAt}, ${updatedAt}
      )
      ON CONFLICT (user_email, id) DO UPDATE SET
        english = EXCLUDED.english,
        vietnamese = EXCLUDED.vietnamese,
        alt_meanings = CASE
          WHEN EXCLUDED.alt_meanings <> '[]' THEN EXCLUDED.alt_meanings
          ELSE et_flashcards.alt_meanings
        END,
        phonetic = CASE
          WHEN EXCLUDED.phonetic <> '' THEN EXCLUDED.phonetic
          ELSE et_flashcards.phonetic
        END,
        part_of_speech = CASE
          WHEN EXCLUDED.part_of_speech <> '' THEN EXCLUDED.part_of_speech
          ELSE et_flashcards.part_of_speech
        END,
        audio_url = CASE
          WHEN EXCLUDED.audio_url <> '' THEN EXCLUDED.audio_url
          ELSE et_flashcards.audio_url
        END,
        updated_at = EXCLUDED.updated_at
      WHERE et_flashcards.updated_at <= EXCLUDED.updated_at
    `;
  }

  if (body.lightResponse) {
    return { updatedAt: now };
  }

  const full = await readUserFromPostgres(sql, email, 0);
  return full.data;
}

module.exports = async function handler(req, res) {
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
      const since = Number(req.query.since) || 0;
      if (!email) {
        return res.status(400).json({
          ok: false,
          error: 'Missing email query parameter'
        });
      }

      const result = await readUserFromPostgres(sql, email, since);
      if (result.unchanged) {
        return res.status(200).json({
          ok: true,
          unchanged: true,
          updatedAt: result.updatedAt
        });
      }

      return res.status(200).json({
        ok: true,
        unchanged: false,
        data: result.data
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

      const result = await writeUserToPostgres(sql, email, body);
      if (body.lightResponse) {
        return res.status(200).json({
          ok: true,
          updatedAt: result.updatedAt
        });
      }

      return res.status(200).json({
        ok: true,
        data: result
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
