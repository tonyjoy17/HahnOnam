require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

/* -------------------------------- Health -------------------------------- */
app.get('/api/health', (_req, res) => res.json({ ok: true }));

/* ------------------------------ Collections ----------------------------- */
// Events: expose `type` derived from is_team_game for your frontend
app.get('/api/events', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id,
             name,
             CASE WHEN is_team_game THEN 'team' ELSE 'individual' END AS type
      FROM events
      ORDER BY id;
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/events failed', err);
    res.status(500).json({ message: 'Failed to fetch events' });
  }
});

app.get('/api/teams', async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT id, name FROM teams ORDER BY id;');
    res.json(rows);
  } catch (err) {
    console.error('GET /api/teams failed', err);
    res.status(500).json({ message: 'Failed to fetch teams' });
  }
});

app.get('/api/players', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, name, team_id AS "teamId"
      FROM players
      ORDER BY id;
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/players failed', err);
    res.status(500).json({ message: 'Failed to fetch players' });
  }
});

/* -------------------------------- Results ------------------------------- */
/**
 * Body for team event:
 *   { winnerTeamId: number, secondTeamId: number }
 *
 * Body for individual event:
 *   { firstPlayerId: number, secondPlayerId: number, thirdPlayerId: number }
 */
app.post('/api/events/:eventId/results', async (req, res) => {
  const eventId = Number(req.params.eventId);
  const body = req.body || {};

  // Server-side source of truth for points (triggers will also set these)
  const TEAM_POINTS = { 1: 20, 2: 10 };
  const IND_POINTS  = { 1: 10, 2: 5, 3: 2 };

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Determine event type from DB
    const ev = await client.query('SELECT is_team_game FROM events WHERE id=$1', [eventId]);
    if (ev.rowCount === 0) throw new Error(`Event ${eventId} not found`);
    const isTeamGame = ev.rows[0].is_team_game;

    if (isTeamGame) {
      const { winnerTeamId, secondTeamId } = body;
      if (!winnerTeamId || !secondTeamId) {
        throw new Error('winnerTeamId and secondTeamId are required for team events');
      }
      await client.query('DELETE FROM results_team WHERE event_id=$1', [eventId]);
      await client.query(
        `INSERT INTO results_team (event_id, team_id, position, points)
         VALUES ($1,$2,1,$3), ($1,$4,2,$5)`,
        [eventId, winnerTeamId, TEAM_POINTS[1], secondTeamId, TEAM_POINTS[2]]
      );
    } else {
      const { firstPlayerId, secondPlayerId, thirdPlayerId } = body;
      if (!firstPlayerId || !secondPlayerId || !thirdPlayerId) {
        throw new Error('firstPlayerId, secondPlayerId, thirdPlayerId are required for individual events');
      }
      await client.query('DELETE FROM results_individual WHERE event_id=$1', [eventId]);
      await client.query(
        `INSERT INTO results_individual (event_id, player_id, position, points)
         VALUES
           ($1,$2,1,$3),
           ($1,$4,2,$5),
           ($1,$6,3,$7)`,
        [eventId, firstPlayerId, IND_POINTS[1], secondPlayerId, IND_POINTS[2], thirdPlayerId, IND_POINTS[3]]
      );
    }

    await client.query('COMMIT');
    res.sendStatus(204);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/events/:eventId/results failed', err);
    res.status(400).json({ message: String(err.message || err) });
  } finally {
    client.release();
  }
});

/* ---------------------------------- MVP --------------------------------- */
/**
 * Body: { playerId: number }
 * - Only for individual events.
 * - Sets exactly one MVP (boolean) within the event.
 */
app.put('/api/events/:eventId/mvp', async (req, res) => {
  const eventId = Number(req.params.eventId);
  const { playerId } = req.body || {};
  if (!playerId) return res.status(400).json({ message: 'playerId required' });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const ev = await client.query('SELECT is_team_game FROM events WHERE id=$1', [eventId]);
    if (ev.rowCount === 0) throw new Error(`Event ${eventId} not found`);
    if (ev.rows[0].is_team_game) throw new Error('MVP not applicable to team games');

    // Clear previous MVPs
    await client.query('UPDATE results_individual SET mvp = FALSE WHERE event_id = $1', [eventId]);

    // Set MVP for this player in this event
    const upd = await client.query(
      `UPDATE results_individual
       SET mvp = TRUE
       WHERE event_id = $1 AND player_id = $2`,
      [eventId, playerId]
    );
    if (upd.rowCount === 0) throw new Error('No individual result found for that player in this event');

    await client.query('COMMIT');
    res.sendStatus(204);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT /api/events/:eventId/mvp failed', err);
    res.status(400).json({ message: String(err.message || err) });
  } finally {
    client.release();
  }
});

/* ---------------------------- Standings & Medals ------------------------ */
/**
 * GET /api/standings/teams
 * - Team total points = team-game points + sum of members’ individual points
 */
app.get('/api/standings/teams', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      WITH indiv_points AS (
        SELECT p.team_id, ri.points
        FROM results_individual ri
        JOIN players p ON p.id = ri.player_id
        JOIN events e  ON e.id = ri.event_id
        WHERE e.is_team_game = FALSE
      ),
      team_points AS (
        SELECT rt.team_id, rt.points
        FROM results_team rt
        JOIN events e ON e.id = rt.event_id
        WHERE e.is_team_game = TRUE
      ),
      all_points AS (
        SELECT team_id, points FROM indiv_points
        UNION ALL
        SELECT team_id, points FROM team_points
      )
      SELECT t.id AS "teamId",
             t.name AS "teamName",
             COALESCE(SUM(ap.points), 0) AS "totalPoints"
      FROM teams t
      LEFT JOIN all_points ap ON ap.team_id = t.id
      GROUP BY t.id, t.name
      ORDER BY "totalPoints" DESC, "teamName" ASC;
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/standings/teams failed', err);
    res.status(500).json({ message: 'Failed to fetch standings' });
  }
});

/**
 * GET /api/medals
 * - Medal counts across team + individual events (team: gold/silver only)
 */
app.get('/api/medals', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      WITH indiv AS (
        SELECT p.team_id,
               CASE ri.position WHEN 1 THEN 1 ELSE 0 END AS gold,
               CASE ri.position WHEN 2 THEN 1 ELSE 0 END AS silver,
               CASE ri.position WHEN 3 THEN 1 ELSE 0 END AS bronze
        FROM results_individual ri
        JOIN players p ON p.id = ri.player_id
        JOIN events e  ON e.id = ri.event_id
        WHERE e.is_team_game = FALSE
      ),
      tgame AS (
        SELECT rt.team_id,
               CASE rt.position WHEN 1 THEN 1 ELSE 0 END AS gold,
               CASE rt.position WHEN 2 THEN 1 ELSE 0 END AS silver,
               0 AS bronze
        FROM results_team rt
        JOIN events e ON e.id = rt.event_id
        WHERE e.is_team_game = TRUE
      ),
      all_medals AS (
        SELECT * FROM indiv
        UNION ALL
        SELECT * FROM tgame
      )
      SELECT
        t.id   AS "teamId",
        t.name AS "teamName",
        COALESCE(SUM(am.gold),   0) AS gold,
        COALESCE(SUM(am.silver), 0) AS silver,
        COALESCE(SUM(am.bronze), 0) AS bronze
      FROM teams t
      LEFT JOIN all_medals am ON am.team_id = t.id
      GROUP BY t.id, t.name
      ORDER BY gold DESC, silver DESC, bronze DESC, "teamName" ASC;
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/medals failed', err);
    res.status(500).json({ message: 'Failed to fetch medals' });
  }
});

/**
 * GET /api/standings/ranked
 * - Olympic-style ranking (gold → silver → bronze → total points → name)
 * - Returns medals + totalPoints + rank
 */
app.get('/api/standings/ranked', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      WITH team_standings AS (
        WITH indiv_points AS (
          SELECT p.team_id, ri.points
          FROM results_individual ri
          JOIN players p ON p.id = ri.player_id
          JOIN events e  ON e.id = ri.event_id
          WHERE e.is_team_game = FALSE
        ),
        team_points AS (
          SELECT rt.team_id, rt.points
          FROM results_team rt
          JOIN events e ON e.id = rt.event_id
          WHERE e.is_team_game = TRUE
        ),
        all_points AS (
          SELECT team_id, points FROM indiv_points
          UNION ALL
          SELECT team_id, points FROM team_points
        )
        SELECT
          t.id AS team_id,
          t.name AS team_name,
          COALESCE(SUM(ap.points), 0) AS total_points
        FROM teams t
        LEFT JOIN all_points ap ON ap.team_id = t.id
        GROUP BY t.id, t.name
      ),
      team_medals AS (
        WITH indiv AS (
          SELECT p.team_id,
                 CASE ri.position WHEN 1 THEN 1 ELSE 0 END AS gold,
                 CASE ri.position WHEN 2 THEN 1 ELSE 0 END AS silver,
                 CASE ri.position WHEN 3 THEN 1 ELSE 0 END AS bronze
          FROM results_individual ri
          JOIN players p ON p.id = ri.player_id
          JOIN events e  ON e.id = ri.event_id
          WHERE e.is_team_game = FALSE
        ),
        tgame AS (
          SELECT rt.team_id,
                 CASE rt.position WHEN 1 THEN 1 ELSE 0 END AS gold,
                 CASE rt.position WHEN 2 THEN 1 ELSE 0 END AS silver,
                 0 AS bronze
          FROM results_team rt
          JOIN events e ON e.id = rt.event_id
          WHERE e.is_team_game = TRUE
        ),
        all_medals AS (
          SELECT * FROM indiv
          UNION ALL
          SELECT * FROM tgame
        )
        SELECT
          t.id   AS team_id,
          t.name AS team_name,
          COALESCE(SUM(am.gold),   0) AS gold,
          COALESCE(SUM(am.silver), 0) AS silver,
          COALESCE(SUM(am.bronze), 0) AS bronze
        FROM teams t
        LEFT JOIN all_medals am ON am.team_id = t.id
        GROUP BY t.id, t.name
      )
      SELECT
        tm.team_id   AS "teamId",
        tm.team_name AS "teamName",
        tm.gold,
        tm.silver,
        tm.bronze,
        ts.total_points AS "totalPoints",
        DENSE_RANK() OVER (
          ORDER BY tm.gold DESC, tm.silver DESC, tm.bronze DESC, ts.total_points DESC, tm.team_name ASC
        ) AS rank
      FROM team_medals tm
      JOIN team_standings ts ON ts.team_id = tm.team_id
      ORDER BY rank, "teamName";
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/standings/ranked failed', err);
    res.status(500).json({ message: 'Failed to fetch ranked standings' });
  }
});

// GET /api/highlights
app.get('/api/highlights', async (_req, res) => {
  try {
    const topTeamQuery = ` /* unchanged – keep your existing top team SQL */ 
      WITH team_standings AS (
        WITH indiv_points AS (
          SELECT p.team_id, ri.points
          FROM results_individual ri
          JOIN players p ON p.id = ri.player_id
          JOIN events e  ON e.id = ri.event_id
          WHERE e.is_team_game = FALSE
        ),
        team_points AS (
          SELECT rt.team_id, rt.points
          FROM results_team rt
          JOIN events e ON e.id = rt.event_id
          WHERE e.is_team_game = TRUE
        ),
        all_points AS (
          SELECT team_id, points FROM indiv_points
          UNION ALL
          SELECT team_id, points FROM team_points
        )
        SELECT t.id AS team_id, t.name AS team_name, COALESCE(SUM(ap.points),0) AS total_points
        FROM teams t
        LEFT JOIN all_points ap ON ap.team_id = t.id
        GROUP BY t.id, t.name
      ),
      team_medals AS (
        WITH indiv AS (
          SELECT p.team_id,
                 CASE ri.position WHEN 1 THEN 1 ELSE 0 END AS gold,
                 CASE ri.position WHEN 2 THEN 1 ELSE 0 END AS silver,
                 CASE ri.position WHEN 3 THEN 1 ELSE 0 END AS bronze
          FROM results_individual ri
          JOIN players p ON p.id = ri.player_id
          JOIN events e  ON e.id = ri.event_id
          WHERE e.is_team_game = FALSE
        ),
        tgame AS (
          SELECT rt.team_id,
                 CASE rt.position WHEN 1 THEN 1 ELSE 0 END AS gold,
                 CASE rt.position WHEN 2 THEN 1 ELSE 0 END AS silver,
                 0 AS bronze
          FROM results_team rt
          JOIN events e ON e.id = rt.event_id
          WHERE e.is_team_game = TRUE
        ),
        all_medals AS (SELECT * FROM indiv UNION ALL SELECT * FROM tgame)
        SELECT t.id AS team_id, t.name AS team_name,
               COALESCE(SUM(am.gold),0) AS gold,
               COALESCE(SUM(am.silver),0) AS silver,
               COALESCE(SUM(am.bronze),0) AS bronze
        FROM teams t LEFT JOIN all_medals am ON am.team_id = t.id
        GROUP BY t.id, t.name
      )
      SELECT ts.team_id   AS "teamId",
             ts.team_name AS "teamName",
             tm.gold, tm.silver, tm.bronze,
             ts.total_points AS "totalPoints"
      FROM team_standings ts
      JOIN team_medals tm ON tm.team_id = ts.team_id
      ORDER BY tm.gold DESC, tm.silver DESC, tm.bronze DESC, ts.total_points DESC, ts.team_name ASC
      LIMIT 1;
    `;

    // NEW: Top individual overall (sum of points across individual events) + medals
    const topPlayerQuery = `
      WITH player_points AS (
        SELECT p.id   AS player_id,
               p.name AS player_name,
               t.id   AS team_id,
               t.name AS team_name,
               COALESCE(SUM(ri.points),0) AS total_points
        FROM players p
        JOIN teams t ON t.id = p.team_id
        LEFT JOIN results_individual ri ON ri.player_id = p.id
        LEFT JOIN events e ON e.id = ri.event_id AND e.is_team_game = FALSE
        GROUP BY p.id, p.name, t.id, t.name
      ),
      player_medals AS (
        SELECT p.id AS player_id,
               COALESCE(SUM(CASE ri.position WHEN 1 THEN 1 ELSE 0 END),0) AS gold,
               COALESCE(SUM(CASE ri.position WHEN 2 THEN 1 ELSE 0 END),0) AS silver,
               COALESCE(SUM(CASE ri.position WHEN 3 THEN 1 ELSE 0 END),0) AS bronze
        FROM players p
        LEFT JOIN results_individual ri ON ri.player_id = p.id
        LEFT JOIN events e ON e.id = ri.event_id AND e.is_team_game = FALSE
        GROUP BY p.id
      )
      SELECT
        pp.player_id    AS "playerId",
        pp.player_name  AS "playerName",
        pp.team_id      AS "teamId",
        pp.team_name    AS "teamName",
        pm.gold, pm.silver, pm.bronze,
        pp.total_points AS "points"
      FROM player_points pp
      JOIN player_medals pm ON pm.player_id = pp.player_id
      ORDER BY pp.total_points DESC, pm.gold DESC, pm.silver DESC, pm.bronze DESC, pp.player_name ASC
      LIMIT 1;
    `;

    const [topTeamRes, topPlayerRes] = await Promise.all([
      db.query(topTeamQuery),
      db.query(topPlayerQuery),
    ]);

    res.json({
      topTeam: topTeamRes.rows[0] || null,
      topPlayer: topPlayerRes.rows[0] || null, // ← renamed field
    });
  } catch (err) {
    console.error('GET /api/highlights failed', err);
    res.status(500).json({ message: 'Failed to fetch highlights' });
  }
});

// GET /api/standings/players
app.get('/api/standings/players', async (_req, res) => {
  try {
    const { rows } = await db.query(`
      WITH player_points AS (
        SELECT p.id AS player_id,
               p.name AS player_name,
               t.id AS team_id,
               t.name AS team_name,
               COALESCE(SUM(ri.points),0) AS total_points
        FROM players p
        JOIN teams t ON t.id = p.team_id
        LEFT JOIN results_individual ri ON ri.player_id = p.id
        LEFT JOIN events e ON e.id = ri.event_id AND e.is_team_game = FALSE
        GROUP BY p.id, p.name, t.id, t.name
      ),
      player_medals AS (
        SELECT p.id AS player_id,
               COALESCE(SUM(CASE ri.position WHEN 1 THEN 1 ELSE 0 END),0) AS gold,
               COALESCE(SUM(CASE ri.position WHEN 2 THEN 1 ELSE 0 END),0) AS silver,
               COALESCE(SUM(CASE ri.position WHEN 3 THEN 1 ELSE 0 END),0) AS bronze
        FROM players p
        LEFT JOIN results_individual ri ON ri.player_id = p.id
        LEFT JOIN events e ON e.id = ri.event_id AND e.is_team_game = FALSE
        GROUP BY p.id
      )
      SELECT
        pp.player_id   AS "playerId",
        pp.player_name AS "playerName",
        pp.team_id     AS "teamId",
        pp.team_name   AS "teamName",
        pm.gold, pm.silver, pm.bronze,
        pp.total_points AS "totalPoints",
        DENSE_RANK() OVER (
          ORDER BY pm.gold DESC, pm.silver DESC, pm.bronze DESC, pp.total_points DESC, pp.player_name ASC
        ) AS rank
      FROM player_points pp
      JOIN player_medals pm ON pm.player_id = pp.player_id
      ORDER BY rank, "playerName";
    `);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/standings/players failed', err);
    res.status(500).json({ message: 'Failed to fetch player standings' });
  }
});


/* --------------------------------- Listen ------------------------------- */
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
